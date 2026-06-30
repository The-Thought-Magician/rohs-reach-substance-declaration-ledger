import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  products,
  compliance_results,
  components,
  materials,
  material_substances,
  svhc_substances,
  exemptions,
  applied_exemptions,
  declarations,
  suppliers,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// GET /overview?workspace_id= — portfolio analytics overview
// Returns: { counts, coverageTrend, svhcExposure, exemptionRunway, supplierResponsiveness }
router.get('/overview', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  // ---- Status counts across the product portfolio ----------------------
  const allProducts = await db
    .select()
    .from(products)
    .where(eq(products.workspace_id, workspaceId))

  const counts = {
    total: allProducts.length,
    compliant: 0,
    non_compliant: 0,
    at_risk: 0,
    incomplete: 0,
  }
  for (const p of allProducts) {
    switch (p.compliance_status) {
      case 'compliant':
        counts.compliant++
        break
      case 'non_compliant':
        counts.non_compliant++
        break
      case 'at_risk':
        counts.at_risk++
        break
      default:
        counts.incomplete++
        break
    }
  }

  // ---- Coverage trend: average coverage_pct per computation day --------
  const results = await db
    .select()
    .from(compliance_results)
    .where(eq(compliance_results.workspace_id, workspaceId))
    .orderBy(compliance_results.computed_at)

  const byDay = new Map<string, { sum: number; n: number }>()
  for (const r of results) {
    const day = (r.computed_at ?? r.created_at ?? new Date()).toISOString().slice(0, 10)
    const entry = byDay.get(day) ?? { sum: 0, n: 0 }
    entry.sum += r.coverage_pct ?? 0
    entry.n += 1
    byDay.set(day, entry)
  }
  const coverageTrend = Array.from(byDay.entries())
    .map(([date, { sum, n }]) => ({ date, coveragePct: n > 0 ? Math.round((sum / n) * 100) / 100 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const latestCoverage =
    coverageTrend.length > 0 ? coverageTrend[coverageTrend.length - 1].coveragePct : 0

  // ---- SVHC exposure: substances in the workspace's parts that appear --
  // on the SVHC candidate list, above the article threshold ------------
  const wsComponents = await db
    .select()
    .from(components)
    .where(eq(components.workspace_id, workspaceId))
  const componentIds = new Set(wsComponents.map((x) => x.id))

  const allMaterials = wsComponents.length
    ? await db.select().from(materials)
    : []
  const wsMaterials = allMaterials.filter((m) => componentIds.has(m.component_id))
  const materialIds = new Set(wsMaterials.map((m) => m.id))

  const allMatSub = wsMaterials.length
    ? await db.select().from(material_substances)
    : []
  const wsMatSub = allMatSub.filter((s) => materialIds.has(s.material_id))

  const svhc = await db.select().from(svhc_substances)
  const svhcByCas = new Map<string, (typeof svhc)[number]>()
  for (const s of svhc) {
    if (s.cas_number) svhcByCas.set(s.cas_number, s)
  }

  const svhcExposureMap = new Map<string, { substance: string; cas: string | null; count: number; maxPpm: number }>()
  for (const ms of wsMatSub) {
    if (!ms.cas_number) continue
    const match = svhcByCas.get(ms.cas_number)
    if (!match) continue
    const threshold = match.article_threshold_ppm ?? 1000
    if ((ms.concentration_ppm ?? 0) <= threshold) continue
    const key = ms.cas_number
    const prev = svhcExposureMap.get(key) ?? {
      substance: match.name,
      cas: ms.cas_number,
      count: 0,
      maxPpm: 0,
    }
    prev.count += 1
    prev.maxPpm = Math.max(prev.maxPpm, ms.concentration_ppm ?? 0)
    svhcExposureMap.set(key, prev)
  }
  const svhcExposure = {
    affectedSubstances: svhcExposureMap.size,
    items: Array.from(svhcExposureMap.values()).sort((a, b) => b.count - a.count),
  }

  // ---- Exemption runway: applied exemptions bucketed by time-to-expiry -
  const wsApplied = await db
    .select()
    .from(applied_exemptions)
    .where(eq(applied_exemptions.workspace_id, workspaceId))
  const allExemptions = await db.select().from(exemptions)
  const exById = new Map(allExemptions.map((e) => [e.id, e]))

  const now = Date.now()
  const DAY = 86_400_000
  const runwayBuckets = { expired: 0, within30: 0, within90: 0, within180: 0, beyond: 0, noExpiry: 0 }
  const exemptionRunwayItems: Array<{
    appliedId: string
    exemptionNumber: string
    substance: string | null
    expiryDate: string | null
    daysToExpiry: number | null
  }> = []
  for (const ae of wsApplied) {
    const ex = exById.get(ae.exemption_id)
    if (!ex) continue
    if (!ex.expiry_date) {
      runwayBuckets.noExpiry++
      exemptionRunwayItems.push({
        appliedId: ae.id,
        exemptionNumber: ex.exemption_number,
        substance: ex.substance_name,
        expiryDate: null,
        daysToExpiry: null,
      })
      continue
    }
    const expMs = ex.expiry_date.getTime()
    const days = Math.round((expMs - now) / DAY)
    if (days < 0) runwayBuckets.expired++
    else if (days <= 30) runwayBuckets.within30++
    else if (days <= 90) runwayBuckets.within90++
    else if (days <= 180) runwayBuckets.within180++
    else runwayBuckets.beyond++
    exemptionRunwayItems.push({
      appliedId: ae.id,
      exemptionNumber: ex.exemption_number,
      substance: ex.substance_name,
      expiryDate: ex.expiry_date.toISOString(),
      daysToExpiry: days,
    })
  }
  exemptionRunwayItems.sort((a, b) => {
    if (a.daysToExpiry === null) return 1
    if (b.daysToExpiry === null) return -1
    return a.daysToExpiry - b.daysToExpiry
  })
  const exemptionRunway = { buckets: runwayBuckets, items: exemptionRunwayItems }

  // ---- Supplier responsiveness: declarations-on-file & score ----------
  const wsSuppliers = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspaceId))
  const wsDeclarations = await db
    .select()
    .from(declarations)
    .where(eq(declarations.workspace_id, workspaceId))
  const declCountBySupplier = new Map<string, number>()
  for (const d of wsDeclarations) {
    if (!d.supplier_id) continue
    declCountBySupplier.set(d.supplier_id, (declCountBySupplier.get(d.supplier_id) ?? 0) + 1)
  }
  const supplierResponsiveness = wsSuppliers
    .map((s) => ({
      supplierId: s.id,
      name: s.name,
      responsivenessScore: s.responsiveness_score ?? 0,
      declarationsOnFile: declCountBySupplier.get(s.id) ?? 0,
    }))
    .sort((a, b) => b.responsivenessScore - a.responsivenessScore)

  return c.json({
    counts,
    latestCoverage,
    coverageTrend,
    svhcExposure,
    exemptionRunway,
    supplierResponsiveness,
  })
})

export default router
