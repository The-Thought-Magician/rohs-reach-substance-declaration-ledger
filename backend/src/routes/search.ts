import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  products,
  components,
  suppliers,
  material_substances,
  materials,
  restricted_substances,
  svhc_substances,
  bom_items,
  bom_versions,
} from '../db/schema.js'
import { eq, and, or, ilike } from 'drizzle-orm'

const router = new Hono()

// Public: global search across products, components, suppliers, substances.
// GET /?q=&workspace_id=
router.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const workspaceId = c.req.query('workspace_id')

  if (!q) {
    return c.json({ products: [], components: [], suppliers: [], substances: [] })
  }

  const like = `%${q}%`

  // Products: match on name / sku / part_number.
  const productMatch = or(
    ilike(products.name, like),
    ilike(products.sku, like),
    ilike(products.part_number, like),
  )
  const productRows = await db
    .select()
    .from(products)
    .where(workspaceId ? and(eq(products.workspace_id, workspaceId), productMatch) : productMatch)
    .limit(25)

  // Components: match on name / manufacturer_part_number / manufacturer / description.
  const componentMatch = or(
    ilike(components.name, like),
    ilike(components.manufacturer_part_number, like),
    ilike(components.manufacturer, like),
    ilike(components.description, like),
  )
  const componentRows = await db
    .select()
    .from(components)
    .where(
      workspaceId ? and(eq(components.workspace_id, workspaceId), componentMatch) : componentMatch,
    )
    .limit(25)

  // Suppliers: match on name / region.
  const supplierMatch = or(ilike(suppliers.name, like), ilike(suppliers.region, like))
  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(
      workspaceId ? and(eq(suppliers.workspace_id, workspaceId), supplierMatch) : supplierMatch,
    )
    .limit(25)

  // Substances: union of restricted (RoHS), SVHC (REACH), and observed material substances.
  const restrictedRows = await db
    .select()
    .from(restricted_substances)
    .where(or(ilike(restricted_substances.name, like), ilike(restricted_substances.cas_number, like)))
    .limit(25)

  const svhcRows = await db
    .select()
    .from(svhc_substances)
    .where(or(ilike(svhc_substances.name, like), ilike(svhc_substances.cas_number, like)))
    .limit(25)

  const observedRows = await db
    .select({
      substance_name: material_substances.substance_name,
      cas_number: material_substances.cas_number,
    })
    .from(material_substances)
    .where(
      or(
        ilike(material_substances.substance_name, like),
        ilike(material_substances.cas_number, like),
      ),
    )
    .limit(25)

  const substanceMap = new Map<string, { name: string; cas_number: string | null; source: string }>()
  for (const r of restrictedRows) {
    const key = (r.cas_number ?? r.name).toLowerCase()
    if (!substanceMap.has(key))
      substanceMap.set(key, { name: r.name, cas_number: r.cas_number, source: 'rohs' })
  }
  for (const r of svhcRows) {
    const key = (r.cas_number ?? r.name).toLowerCase()
    if (!substanceMap.has(key))
      substanceMap.set(key, { name: r.name, cas_number: r.cas_number, source: 'svhc' })
  }
  for (const r of observedRows) {
    const key = (r.cas_number ?? r.substance_name).toLowerCase()
    if (!substanceMap.has(key))
      substanceMap.set(key, {
        name: r.substance_name,
        cas_number: r.cas_number,
        source: 'declared',
      })
  }

  return c.json({
    products: productRows,
    components: componentRows,
    suppliers: supplierRows,
    substances: Array.from(substanceMap.values()),
  })
})

// Public: reverse lookup — every product/part containing a CAS number.
// GET /substance?cas=&workspace_id=
router.get('/substance', async (c) => {
  const cas = (c.req.query('cas') ?? '').trim()
  const workspaceId = c.req.query('workspace_id')

  if (!cas) return c.json({ cas, hits: [] })

  // material_substances -> materials -> components -> bom_items -> bom_versions -> products
  const conds = [eq(material_substances.cas_number, cas)]
  if (workspaceId) conds.push(eq(components.workspace_id, workspaceId))

  const rows = await db
    .select({
      product_id: products.id,
      product_name: products.name,
      product_sku: products.sku,
      component_id: components.id,
      component_name: components.name,
      manufacturer_part_number: components.manufacturer_part_number,
      material_id: materials.id,
      material_name: materials.name,
      substance_name: material_substances.substance_name,
      cas_number: material_substances.cas_number,
      concentration_ppm: material_substances.concentration_ppm,
    })
    .from(material_substances)
    .innerJoin(materials, eq(material_substances.material_id, materials.id))
    .innerJoin(components, eq(materials.component_id, components.id))
    .innerJoin(bom_items, eq(bom_items.component_id, components.id))
    .innerJoin(bom_versions, eq(bom_items.bom_version_id, bom_versions.id))
    .innerJoin(products, eq(bom_versions.product_id, products.id))
    .where(and(...conds))

  // De-duplicate identical (product, component, material) hits across BOM versions.
  const seen = new Set<string>()
  const hits = []
  for (const r of rows) {
    const key = `${r.product_id}|${r.component_id}|${r.material_id}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      product: { id: r.product_id, name: r.product_name, sku: r.product_sku },
      component: {
        id: r.component_id,
        name: r.component_name,
        manufacturer_part_number: r.manufacturer_part_number,
      },
      material: { id: r.material_id, name: r.material_name },
      substance_name: r.substance_name,
      concentration_ppm: r.concentration_ppm,
    })
  }

  return c.json({ cas, hits })
})

export default router
