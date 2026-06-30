import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq, and, desc, inArray } from 'drizzle-orm'
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
  exemptions,
  compliance_results,
  audit_events,
  notifications,
  workspaces,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

function normCas(cas: string | null | undefined): string {
  return (cas ?? '').trim().toLowerCase()
}

interface DetailRow {
  component_id: string
  component_name: string
  material_id: string
  material_name: string
  substance_name: string
  cas_number: string | null
  concentration_ppm: number
  basis: 'RoHS' | 'REACH'
  threshold_ppm: number
  verdict: 'pass' | 'fail'
  exempted: boolean
  exemption_number?: string
}

interface ComputeOutput {
  rohs_verdict: string
  reach_verdict: string
  overall_verdict: string
  offending_component_id: string | null
  offending_substance: string | null
  coverage_pct: number
  details: DetailRow[]
}

// ---------------------------------------------------------------------------
// Deterministic threshold engine for a single product.
// Traverses the active BOM → components → materials → substances and checks
// each homogeneous-material substance against RoHS (restricted_substances) and
// REACH (svhc_substances) thresholds, honoring non-expired applied exemptions.
// ---------------------------------------------------------------------------
async function computeForProduct(productId: string): Promise<ComputeOutput> {
  // Resolve the active BOM version (fall back to most recent).
  const versions = await db
    .select()
    .from(bom_versions)
    .where(eq(bom_versions.product_id, productId))
    .orderBy(desc(bom_versions.created_at))
  const active = versions.find((v) => v.is_active) ?? versions[0]

  // Restricted (RoHS) and SVHC (REACH) catalogs, indexed by normalized CAS.
  const restricted = await db.select().from(restricted_substances)
  const svhc = await db.select().from(svhc_substances)
  const restrictedByCas = new Map<string, typeof restricted[number]>()
  for (const r of restricted) if (r.cas_number) restrictedByCas.set(normCas(r.cas_number), r)
  const svhcByCas = new Map<string, typeof svhc[number]>()
  for (const s of svhc) if (s.cas_number) svhcByCas.set(normCas(s.cas_number), s)

  if (!active) {
    return {
      rohs_verdict: 'unknown',
      reach_verdict: 'unknown',
      overall_verdict: 'incomplete',
      offending_component_id: null,
      offending_substance: null,
      coverage_pct: 0,
      details: [],
    }
  }

  const items = await db
    .select()
    .from(bom_items)
    .where(eq(bom_items.bom_version_id, active.id))
  const componentIds = Array.from(
    new Set(items.map((i) => i.component_id).filter((x): x is string => !!x)),
  )

  if (componentIds.length === 0) {
    return {
      rohs_verdict: 'unknown',
      reach_verdict: 'unknown',
      overall_verdict: 'incomplete',
      offending_component_id: null,
      offending_substance: null,
      coverage_pct: 0,
      details: [],
    }
  }

  const comps = await db
    .select()
    .from(components)
    .where(inArray(components.id, componentIds))
  const compById = new Map(comps.map((cmp) => [cmp.id, cmp]))

  const mats = await db
    .select()
    .from(materials)
    .where(inArray(materials.component_id, componentIds))
  const matIds = mats.map((m) => m.id)
  const subs = matIds.length
    ? await db
        .select()
        .from(material_substances)
        .where(inArray(material_substances.material_id, matIds))
    : []
  const subsByMaterial = new Map<string, typeof subs>()
  for (const s of subs) {
    const arr = subsByMaterial.get(s.material_id) ?? []
    arr.push(s)
    subsByMaterial.set(s.material_id, arr)
  }

  // Active applied exemptions for these components/materials.
  const appliedRows = await db.select().from(applied_exemptions)
  const exemptionRows = await db.select().from(exemptions)
  const exemptionById = new Map(exemptionRows.map((e) => [e.id, e]))
  const now = Date.now()
  // exemptedComponents: component_id -> exemption_number ; exemptedMaterials: material_id -> exemption_number
  const exemptedComponents = new Map<string, string>()
  const exemptedMaterials = new Map<string, string>()
  for (const a of appliedRows) {
    const ex = exemptionById.get(a.exemption_id)
    if (ex?.expiry_date) {
      const exp = new Date(ex.expiry_date as unknown as string).getTime()
      if (exp <= now) continue // expired exemption — does not apply
    }
    const num = ex?.exemption_number ?? a.exemption_id
    if (a.material_id) exemptedMaterials.set(a.material_id, num)
    if (a.component_id) exemptedComponents.set(a.component_id, num)
  }

  const details: DetailRow[] = []
  let rohsFail = false
  let reachFail = false
  let offendingComponentId: string | null = null
  let offendingSubstance: string | null = null

  // Coverage: fraction of BOM components that have at least one declared material substance.
  let coveredComponents = 0

  for (const compId of componentIds) {
    const comp = compById.get(compId)
    const compMats = mats.filter((m) => m.component_id === compId)
    const compHasData = compMats.some((m) => (subsByMaterial.get(m.id) ?? []).length > 0)
    if (compHasData) coveredComponents += 1

    for (const mat of compMats) {
      // Only homogeneous materials are the regulatory basis for RoHS.
      const matSubs = subsByMaterial.get(mat.id) ?? []
      for (const s of matSubs) {
        const cas = normCas(s.cas_number)
        const conc = s.concentration_ppm ?? 0
        const matExempt = exemptedMaterials.has(mat.id)
        const compExempt = exemptedComponents.has(compId)
        const exemptionNumber = exemptedMaterials.get(mat.id) ?? exemptedComponents.get(compId)

        // RoHS check (homogeneous-material basis).
        const restrictedHit = cas ? restrictedByCas.get(cas) : undefined
        if (restrictedHit && mat.is_homogeneous) {
          const exempted = matExempt || compExempt
          const verdict: 'pass' | 'fail' =
            conc > restrictedHit.max_concentration_ppm && !exempted ? 'fail' : 'pass'
          details.push({
            component_id: compId,
            component_name: comp?.name ?? compId,
            material_id: mat.id,
            material_name: mat.name,
            substance_name: s.substance_name,
            cas_number: s.cas_number,
            concentration_ppm: conc,
            basis: 'RoHS',
            threshold_ppm: restrictedHit.max_concentration_ppm,
            verdict,
            exempted,
            exemption_number: exempted ? exemptionNumber : undefined,
          })
          if (verdict === 'fail') {
            rohsFail = true
            if (!offendingComponentId) {
              offendingComponentId = compId
              offendingSubstance = s.substance_name
            }
          }
        }

        // REACH SVHC check (article basis, default 1000 ppm = 0.1%).
        const svhcHit = cas ? svhcByCas.get(cas) : undefined
        if (svhcHit) {
          const threshold = svhcHit.article_threshold_ppm ?? 1000
          const exempted = matExempt || compExempt
          const verdict: 'pass' | 'fail' = conc > threshold && !exempted ? 'fail' : 'pass'
          details.push({
            component_id: compId,
            component_name: comp?.name ?? compId,
            material_id: mat.id,
            material_name: mat.name,
            substance_name: s.substance_name,
            cas_number: s.cas_number,
            concentration_ppm: conc,
            basis: 'REACH',
            threshold_ppm: threshold,
            verdict,
            exempted,
            exemption_number: exempted ? exemptionNumber : undefined,
          })
          if (verdict === 'fail') {
            reachFail = true
            if (!offendingComponentId) {
              offendingComponentId = compId
              offendingSubstance = s.substance_name
            }
          }
        }
      }
    }
  }

  const coveragePct = componentIds.length
    ? Math.round((coveredComponents / componentIds.length) * 1000) / 10
    : 0

  const complete = coveredComponents === componentIds.length && componentIds.length > 0

  const rohsVerdict = rohsFail ? 'fail' : complete ? 'pass' : 'incomplete'
  const reachVerdict = reachFail ? 'fail' : complete ? 'pass' : 'incomplete'
  let overall: string
  if (rohsFail || reachFail) overall = 'fail'
  else if (!complete) overall = 'incomplete'
  else overall = 'pass'

  return {
    rohs_verdict: rohsVerdict,
    reach_verdict: reachVerdict,
    overall_verdict: overall,
    offending_component_id: offendingComponentId,
    offending_substance: offendingSubstance,
    coverage_pct: coveragePct,
    details,
  }
}

// Persist a computed result, update product status, and write audit/notification.
async function persistResult(
  product: typeof products.$inferSelect,
  userId: string,
  out: ComputeOutput,
) {
  const [result] = await db
    .insert(compliance_results)
    .values({
      workspace_id: product.workspace_id,
      product_id: product.id,
      rohs_verdict: out.rohs_verdict,
      reach_verdict: out.reach_verdict,
      overall_verdict: out.overall_verdict,
      offending_component_id: out.offending_component_id,
      offending_substance: out.offending_substance,
      coverage_pct: out.coverage_pct,
      details: out.details as unknown as Array<Record<string, unknown>>,
      computed_at: new Date(),
    })
    .returning()

  const status =
    out.overall_verdict === 'fail'
      ? 'non-compliant'
      : out.overall_verdict === 'pass'
        ? 'compliant'
        : out.coverage_pct > 0
          ? 'at-risk'
          : 'incomplete'

  await db
    .update(products)
    .set({ compliance_status: status, updated_at: new Date() })
    .where(eq(products.id, product.id))

  await db.insert(audit_events).values({
    workspace_id: product.workspace_id,
    user_id: userId,
    action: 'compliance.compute',
    entity_type: 'product',
    entity_id: product.id,
    metadata: {
      overall_verdict: out.overall_verdict,
      rohs_verdict: out.rohs_verdict,
      reach_verdict: out.reach_verdict,
      coverage_pct: out.coverage_pct,
      offending_substance: out.offending_substance,
    },
  })

  if (out.overall_verdict === 'fail') {
    await db.insert(notifications).values({
      workspace_id: product.workspace_id,
      user_id: userId,
      type: 'compliance_fail',
      title: `Compliance failure: ${product.name}`,
      body: `Product "${product.name}" failed compliance${
        out.offending_substance ? ` due to ${out.offending_substance}` : ''
      } (RoHS: ${out.rohs_verdict}, REACH: ${out.reach_verdict}).`,
      link: `/dashboard/products/${product.id}`,
    })
  }

  return result
}

// GET /product/:productId — public — latest computed result
router.get('/product/:productId', async (c) => {
  const productId = c.req.param('productId')
  const [result] = await db
    .select()
    .from(compliance_results)
    .where(eq(compliance_results.product_id, productId))
    .orderBy(desc(compliance_results.computed_at))
    .limit(1)
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
})

// GET /results — public — all results (?workspace_id)
router.get('/results', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(compliance_results)
        .where(eq(compliance_results.workspace_id, workspaceId))
        .orderBy(desc(compliance_results.computed_at))
    : await db.select().from(compliance_results).orderBy(desc(compliance_results.computed_at))
  return c.json(rows)
})

// POST /product/:productId/compute — auth — run engine, persist, audit + notify on fail
router.post('/product/:productId/compute', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const productId = c.req.param('productId')
  const [product] = await db.select().from(products).where(eq(products.id, productId))
  if (!product) return c.json({ error: 'Not found' }, 404)

  const out = await computeForProduct(productId)
  const result = await persistResult(product, userId, out)
  return c.json(result, 201)
})

// POST /recompute-all — auth — recompute every product in a workspace
const recomputeSchema = z.object({ workspace_id: z.string().min(1) })
router.post('/recompute-all', authMiddleware, zValidator('json', recomputeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  const prods = await db.select().from(products).where(eq(products.workspace_id, workspace_id))
  const results = []
  for (const product of prods) {
    const out = await computeForProduct(product.id)
    const result = await persistResult(product, userId, out)
    results.push(result)
  }
  return c.json({ computed: results.length, results })
})

export default router
