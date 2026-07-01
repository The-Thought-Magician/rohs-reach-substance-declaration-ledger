import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  products,
  bom_versions,
  bom_items,
  components,
  materials,
  material_substances,
  restricted_substances,
  svhc_substances,
  applied_exemptions,
  compliance_results,
} from '../db/schema.js'
import { authMiddleware, getUserId, userCanAccessWorkspace } from '../lib/auth.js'

const router = new Hono()

const productSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  sku: z.string().optional(),
  part_number: z.string().optional(),
  category: z.string().optional(),
  market_region: z.string().optional(),
  lifecycle_status: z.string().optional(),
  compliance_status: z.string().optional(),
})

function statusBadge(status: string | null): { status: string; label: string; color: string } {
  switch (status) {
    case 'compliant':
      return { status: 'compliant', label: 'Compliant', color: 'green' }
    case 'non_compliant':
      return { status: 'non_compliant', label: 'Non-compliant', color: 'red' }
    case 'at_risk':
      return { status: 'at_risk', label: 'At risk', color: 'amber' }
    default:
      return { status: 'incomplete', label: 'Incomplete', color: 'gray' }
  }
}

// Auth: list products with status badges (?workspace_id required).
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!(await userCanAccessWorkspace(userId, workspaceId))) return c.json({ error: 'Forbidden' }, 403)
  const status = c.req.query('status')

  const conds = [eq(products.workspace_id, workspaceId)]
  if (status) conds.push(eq(products.compliance_status, status))

  const rows = await db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(desc(products.created_at))

  return c.json(rows.map((p) => ({ ...p, badge: statusBadge(p.compliance_status) })))
})

// Auth: product detail + latest compliance result.
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const [p] = await db.select().from(products).where(eq(products.id, c.req.param('id')))
  if (!p) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, p.workspace_id))) return c.json({ error: 'Forbidden' }, 403)
  const [result] = await db
    .select()
    .from(compliance_results)
    .where(eq(compliance_results.product_id, p.id))
    .orderBy(desc(compliance_results.computed_at))
    .limit(1)
  return c.json({ product: { ...p, badge: statusBadge(p.compliance_status) }, result: result ?? null })
})

// Auth: create product.
router.post('/', authMiddleware, zValidator('json', productSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [p] = await db
    .insert(products)
    .values({ ...body, owner_id: userId })
    .returning()
  return c.json(p, 201)
})

// Auth(owner): update product.
router.put('/:id', authMiddleware, zValidator('json', productSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(products).where(eq(products.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(products)
    .set({ ...body, updated_at: new Date() })
    .where(eq(products.id, id))
    .returning()
  return c.json(updated)
})

// Auth(owner): delete product.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(products).where(eq(products.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(products).where(eq(products.id, id))
  return c.json({ success: true })
})

// Auth: full compliance roll-up with drill-down tree.
router.get('/:id/rollup', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [product] = await db.select().from(products).where(eq(products.id, id))
  if (!product) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, product.workspace_id))) return c.json({ error: 'Forbidden' }, 403)

  // Active BOM version (fall back to most recent).
  const versions = await db
    .select()
    .from(bom_versions)
    .where(eq(bom_versions.product_id, id))
    .orderBy(desc(bom_versions.created_at))
  const activeVersion = versions.find((v) => v.is_active) ?? versions[0] ?? null

  // Threshold reference data.
  const restricted = await db.select().from(restricted_substances)
  const svhc = await db.select().from(svhc_substances)
  const restrictedByCas = new Map<string, { max: number; name: string }>()
  for (const r of restricted) {
    if (r.cas_number) restrictedByCas.set(r.cas_number.trim(), { max: r.max_concentration_ppm, name: r.name })
  }
  const svhcByCas = new Map<string, { max: number; name: string }>()
  for (const s of svhc) {
    if (s.cas_number) svhcByCas.set(s.cas_number.trim(), { max: s.article_threshold_ppm, name: s.name })
  }

  // Applied (non-expired) exemptions for this workspace, indexed by component/material.
  const appliedRows = await db
    .select()
    .from(applied_exemptions)
    .where(eq(applied_exemptions.workspace_id, product.workspace_id))
  const now = Date.now()
  const exemptComponentIds = new Set<string>()
  const exemptMaterialIds = new Set<string>()
  for (const a of appliedRows) {
    if (a.component_id) exemptComponentIds.add(a.component_id)
    if (a.material_id) exemptMaterialIds.add(a.material_id)
  }

  let rohsFail = false
  let reachFail = false
  let offendingComponentId: string | null = null
  let offendingSubstance: string | null = null
  let totalComponents = 0
  let coveredComponents = 0

  type SubstanceNode = {
    id: string
    substance_name: string
    cas_number: string | null
    concentration_ppm: number
    rohs_limit: number | null
    reach_limit: number | null
    rohs_violation: boolean
    reach_violation: boolean
    exempt: boolean
  }
  type MaterialNode = {
    id: string
    name: string
    is_homogeneous: boolean
    exempt: boolean
    substances: SubstanceNode[]
  }
  type ComponentNode = {
    bom_item_id: string
    component_id: string | null
    name: string
    reference: string | null
    quantity: number
    exempt: boolean
    hasData: boolean
    materials: MaterialNode[]
  }

  const tree: ComponentNode[] = []

  const items = activeVersion
    ? await db.select().from(bom_items).where(eq(bom_items.bom_version_id, activeVersion.id))
    : []

  for (const item of items) {
    totalComponents++
    let comp: typeof components.$inferSelect | undefined
    if (item.component_id) {
      ;[comp] = await db.select().from(components).where(eq(components.id, item.component_id))
    }
    const compExempt = comp ? exemptComponentIds.has(comp.id) : false

    const matNodes: MaterialNode[] = []
    let hasData = false

    if (comp) {
      const mats = await db.select().from(materials).where(eq(materials.component_id, comp.id))
      for (const mat of mats) {
        const matExempt = compExempt || exemptMaterialIds.has(mat.id)
        const subs = await db
          .select()
          .from(material_substances)
          .where(eq(material_substances.material_id, mat.id))
        if (subs.length > 0) hasData = true

        const subNodes: SubstanceNode[] = subs.map((sub) => {
          const cas = sub.cas_number?.trim()
          const rohs = cas ? restrictedByCas.get(cas) : undefined
          const reach = cas ? svhcByCas.get(cas) : undefined
          const rohsViolation =
            !matExempt && rohs !== undefined && sub.concentration_ppm > rohs.max
          const reachViolation =
            !matExempt && reach !== undefined && sub.concentration_ppm > reach.max

          if (rohsViolation) {
            rohsFail = true
            if (!offendingComponentId) {
              offendingComponentId = comp!.id
              offendingSubstance = sub.substance_name
            }
          }
          if (reachViolation) {
            reachFail = true
            if (!offendingComponentId) {
              offendingComponentId = comp!.id
              offendingSubstance = sub.substance_name
            }
          }

          return {
            id: sub.id,
            substance_name: sub.substance_name,
            cas_number: sub.cas_number,
            concentration_ppm: sub.concentration_ppm,
            rohs_limit: rohs?.max ?? null,
            reach_limit: reach?.max ?? null,
            rohs_violation: rohsViolation,
            reach_violation: reachViolation,
            exempt: matExempt,
          }
        })

        matNodes.push({
          id: mat.id,
          name: mat.name,
          is_homogeneous: mat.is_homogeneous,
          exempt: matExempt,
          substances: subNodes,
        })
      }
    }

    if (hasData) coveredComponents++

    tree.push({
      bom_item_id: item.id,
      component_id: item.component_id,
      name: comp?.name ?? item.reference ?? 'Unknown component',
      reference: item.reference,
      quantity: item.quantity,
      exempt: compExempt,
      hasData,
      materials: matNodes,
    })
  }

  const coveragePct =
    totalComponents > 0 ? Math.round((coveredComponents / totalComponents) * 10000) / 100 : 0

  const rohsVerdict = rohsFail ? 'fail' : coveredComponents > 0 ? 'pass' : 'unknown'
  const reachVerdict = reachFail ? 'fail' : coveredComponents > 0 ? 'pass' : 'unknown'
  let overallVerdict: string
  if (rohsFail || reachFail) overallVerdict = 'fail'
  else if (totalComponents === 0 || coveredComponents < totalComponents) overallVerdict = 'incomplete'
  else overallVerdict = 'pass'

  const offending =
    offendingComponentId || offendingSubstance
      ? { component_id: offendingComponentId, substance: offendingSubstance }
      : null

  return c.json({
    product: { ...product, badge: statusBadge(product.compliance_status) },
    verdict: { rohs: rohsVerdict, reach: reachVerdict, overall: overallVerdict },
    offending,
    coveragePct,
    activeVersion,
    tree,
  })
})

export default router
