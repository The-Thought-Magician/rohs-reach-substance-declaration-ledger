import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  products,
  bom_versions,
  bom_items,
  components,
  materials,
  material_substances,
  svhc_substances,
  applied_exemptions,
} from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId, userCanAccessWorkspace } from '../lib/auth.js'

const router = new Hono()

// REACH SVHC article-notification threshold: 0.1% w/w = 1000 ppm. Each SVHC
// substance carries its own article_threshold_ppm (default 1000).

interface ScipArticle {
  component: typeof components.$inferSelect
  substance: string
  cas_number: string | null
  concentration_ppm: number
  threshold_ppm: number
  location: string // material name where the substance was found
}

// Build the set of SVHC CAS numbers (and per-CAS threshold) from the catalog.
async function loadSvhcIndex() {
  const rows = await db.select().from(svhc_substances)
  const byCas = new Map<string, { name: string; threshold: number }>()
  const byName = new Map<string, { name: string; threshold: number }>()
  for (const s of rows) {
    const threshold = s.article_threshold_ppm ?? 1000
    if (s.cas_number) byCas.set(s.cas_number.trim(), { name: s.name, threshold })
    byName.set(s.name.trim().toLowerCase(), { name: s.name, threshold })
  }
  return { byCas, byName }
}

// Resolve the active BOM version for a product (prefer is_active, else latest).
async function activeBomVersionId(productId: string): Promise<string | null> {
  const versions = await db
    .select()
    .from(bom_versions)
    .where(eq(bom_versions.product_id, productId))
  if (versions.length === 0) return null
  const active = versions.find((v) => v.is_active)
  if (active) return active.id
  versions.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  return versions[0].id
}

// Compute SCIP articles (SVHC > threshold) for a product's active BOM.
async function computeArticlesForProduct(
  product: typeof products.$inferSelect,
): Promise<ScipArticle[]> {
  const versionId = await activeBomVersionId(product.id)
  if (!versionId) return []

  const items = await db
    .select()
    .from(bom_items)
    .where(eq(bom_items.bom_version_id, versionId))
  const componentIds = Array.from(
    new Set(items.map((i) => i.component_id).filter((x): x is string => !!x)),
  )
  if (componentIds.length === 0) return []

  const comps = await db
    .select()
    .from(components)
    .where(inArray(components.id, componentIds))
  const compById = new Map(comps.map((c) => [c.id, c]))

  const mats = await db
    .select()
    .from(materials)
    .where(inArray(materials.component_id, componentIds))
  if (mats.length === 0) return []
  const matById = new Map(mats.map((m) => [m.id, m]))
  const matIds = mats.map((m) => m.id)

  const subs = await db
    .select()
    .from(material_substances)
    .where(inArray(material_substances.material_id, matIds))

  // Applied exemptions in this workspace let us skip flagged components/materials.
  const applied = await db
    .select()
    .from(applied_exemptions)
    .where(eq(applied_exemptions.workspace_id, product.workspace_id))
  const exemptComponents = new Set(
    applied.map((a) => a.component_id).filter((x): x is string => !!x),
  )
  const exemptMaterials = new Set(
    applied.map((a) => a.material_id).filter((x): x is string => !!x),
  )

  const { byCas, byName } = await loadSvhcIndex()
  const articles: ScipArticle[] = []

  for (const sub of subs) {
    const mat = matById.get(sub.material_id)
    if (!mat) continue
    const comp = compById.get(mat.component_id)
    if (!comp) continue

    // Honor applied exemptions covering the component or material.
    if (exemptMaterials.has(mat.id)) continue
    if (exemptComponents.has(comp.id)) continue

    const casKey = sub.cas_number?.trim()
    const match = (casKey && byCas.get(casKey)) || byName.get(sub.substance_name.trim().toLowerCase())
    if (!match) continue

    const threshold = match.threshold ?? 1000
    if ((sub.concentration_ppm ?? 0) > threshold) {
      articles.push({
        component: comp,
        substance: sub.substance_name,
        cas_number: sub.cas_number,
        concentration_ppm: sub.concentration_ppm ?? 0,
        threshold_ppm: threshold,
        location: mat.name,
      })
    }
  }

  return articles
}

// GET /product/:productId — SCIP-readiness: articles requiring notification.
router.get('/product/:productId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const productId = c.req.param('productId')
  const [product] = await db.select().from(products).where(eq(products.id, productId))
  if (!product) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, product.workspace_id))) return c.json({ error: 'Forbidden' }, 403)

  const articles = await computeArticlesForProduct(product)
  return c.json({
    product,
    articles: articles.map((a) => ({
      component: a.component,
      substance: a.substance,
      cas_number: a.cas_number,
      concentration_ppm: a.concentration_ppm,
      threshold_ppm: a.threshold_ppm,
      location: a.location,
    })),
    required: articles.length > 0,
  })
})

// GET / — workspace SCIP summary (?workspace_id required).
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!(await userCanAccessWorkspace(userId, workspaceId))) return c.json({ error: 'Forbidden' }, 403)
  const all = await db.select().from(products).where(eq(products.workspace_id, workspaceId))

  const summary = []
  for (const product of all) {
    const articles = await computeArticlesForProduct(product)
    summary.push({
      product,
      required: articles.length > 0,
      articleCount: articles.length,
    })
  }
  return c.json({ products: summary })
})

export default router
