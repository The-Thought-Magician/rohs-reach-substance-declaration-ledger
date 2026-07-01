import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  products,
  bom_versions,
  bom_items,
  components,
  materials,
  material_substances,
  declarations,
  declaration_substances,
  compliance_results,
  applied_exemptions,
  exemptions,
  reports,
  audit_events,
} from '../db/schema.js'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { authMiddleware, getUserId, userCanAccessWorkspace } from '../lib/auth.js'

const router = new Hono()

// Resolve the active BOM version for a product (prefer is_active, else latest).
async function activeBomVersion(productId: string) {
  const versions = await db
    .select()
    .from(bom_versions)
    .where(eq(bom_versions.product_id, productId))
  if (versions.length === 0) return null
  const active = versions.find((v) => v.is_active)
  if (active) return active
  versions.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  return versions[0]
}

// Assemble the full declaration pack payload for a product.
async function assemblePack(product: typeof products.$inferSelect) {
  const version = await activeBomVersion(product.id)

  // BOM items + their components + materials + substances.
  let bomItems: Array<Record<string, unknown>> = []
  let componentIds: string[] = []
  if (version) {
    const items = await db
      .select()
      .from(bom_items)
      .where(eq(bom_items.bom_version_id, version.id))
    componentIds = Array.from(
      new Set(items.map((i) => i.component_id).filter((x): x is string => !!x)),
    )
    const comps = componentIds.length
      ? await db.select().from(components).where(inArray(components.id, componentIds))
      : []
    const compById = new Map(comps.map((cc) => [cc.id, cc]))

    const mats = componentIds.length
      ? await db.select().from(materials).where(inArray(materials.component_id, componentIds))
      : []
    const matIds = mats.map((m) => m.id)
    const matSubs = matIds.length
      ? await db
          .select()
          .from(material_substances)
          .where(inArray(material_substances.material_id, matIds))
      : []
    const subsByMat = new Map<string, typeof matSubs>()
    for (const s of matSubs) {
      const arr = subsByMat.get(s.material_id) ?? []
      arr.push(s)
      subsByMat.set(s.material_id, arr)
    }
    const matsByComp = new Map<string, Array<Record<string, unknown>>>()
    for (const m of mats) {
      const arr = matsByComp.get(m.component_id) ?? []
      arr.push({ ...m, substances: subsByMat.get(m.id) ?? [] })
      matsByComp.set(m.component_id, arr)
    }

    bomItems = items.map((it) => ({
      ...it,
      component: it.component_id ? compById.get(it.component_id) ?? null : null,
      materials: it.component_id ? matsByComp.get(it.component_id) ?? [] : [],
    }))
  }

  // Declarations on file for those components.
  let decls: Array<Record<string, unknown>> = []
  if (componentIds.length) {
    const rows = await db
      .select()
      .from(declarations)
      .where(
        and(
          eq(declarations.workspace_id, product.workspace_id),
          inArray(declarations.component_id, componentIds),
        ),
      )
    const declIds = rows.map((d) => d.id)
    const declSubs = declIds.length
      ? await db
          .select()
          .from(declaration_substances)
          .where(inArray(declaration_substances.declaration_id, declIds))
      : []
    const subsByDecl = new Map<string, typeof declSubs>()
    for (const s of declSubs) {
      const arr = subsByDecl.get(s.declaration_id) ?? []
      arr.push(s)
      subsByDecl.set(s.declaration_id, arr)
    }
    decls = rows.map((d) => ({ ...d, substances: subsByDecl.get(d.id) ?? [] }))
  }

  // Latest compliance verdict.
  const [verdict] = await db
    .select()
    .from(compliance_results)
    .where(eq(compliance_results.product_id, product.id))
    .orderBy(desc(compliance_results.computed_at))
    .limit(1)

  // Applied exemptions (with catalog detail) for this workspace touching the BOM components.
  const appliedRows = await db
    .select()
    .from(applied_exemptions)
    .where(eq(applied_exemptions.workspace_id, product.workspace_id))
  const relevantApplied = appliedRows.filter(
    (a) => !a.component_id || componentIds.includes(a.component_id),
  )
  const exemptionIds = Array.from(new Set(relevantApplied.map((a) => a.exemption_id)))
  const exemptionCatalog = exemptionIds.length
    ? await db.select().from(exemptions).where(inArray(exemptions.id, exemptionIds))
    : []
  const exemptionById = new Map(exemptionCatalog.map((e) => [e.id, e]))
  const exemptionPack = relevantApplied.map((a) => ({
    ...a,
    exemption: exemptionById.get(a.exemption_id) ?? null,
  }))

  // Certificate: a deterministic conformity statement.
  const overall = verdict?.overall_verdict ?? 'unknown'
  const certificate = {
    product_name: product.name,
    sku: product.sku,
    part_number: product.part_number,
    market_region: product.market_region,
    bom_revision: version?.revision ?? null,
    rohs_verdict: verdict?.rohs_verdict ?? 'unknown',
    reach_verdict: verdict?.reach_verdict ?? 'unknown',
    overall_verdict: overall,
    coverage_pct: verdict?.coverage_pct ?? 0,
    declarations_on_file: decls.length,
    statement:
      overall === 'compliant'
        ? `${product.name} conforms to RoHS and REACH SVHC requirements based on substance declarations on file.`
        : overall === 'non_compliant'
          ? `${product.name} has identified non-compliances; see offending substance details.`
          : `Compliance for ${product.name} is incomplete pending further declarations.`,
    offending_substance: verdict?.offending_substance ?? null,
    offending_component_id: verdict?.offending_component_id ?? null,
    issued_at: new Date().toISOString(),
  }

  return {
    product,
    bom: { version: version ?? null, items: bomItems },
    declarations: decls,
    verdict: verdict ?? null,
    exemptions: exemptionPack,
    certificate,
  }
}

// GET /product/:productId — assembled declaration pack.
router.get('/product/:productId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const productId = c.req.param('productId')
  const [product] = await db.select().from(products).where(eq(products.id, productId))
  if (!product) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, product.workspace_id))) return c.json({ error: 'Forbidden' }, 403)
  const pack = await assemblePack(product)
  return c.json(pack)
})

// POST /product/:productId/export — record an export + return pack payload.
router.post('/product/:productId/export', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const productId = c.req.param('productId')
  const [product] = await db.select().from(products).where(eq(products.id, productId))
  if (!product) return c.json({ error: 'Not found' }, 404)

  const pack = await assemblePack(product)

  const [report] = await db
    .insert(reports)
    .values({
      workspace_id: product.workspace_id,
      type: 'declaration-pack',
      title: `Declaration pack — ${product.name}`,
      payload: pack as unknown as Record<string, unknown>,
      owner_id: userId,
    })
    .returning()

  await db.insert(audit_events).values({
    workspace_id: product.workspace_id,
    user_id: userId,
    action: 'export_declaration_pack',
    entity_type: 'product',
    entity_id: product.id,
    metadata: {
      report_id: report.id,
      overall_verdict: pack.certificate.overall_verdict,
      declarations_on_file: pack.certificate.declarations_on_file,
    },
  })

  return c.json({ report, pack }, 201)
})

export default router
