import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reports,
  products,
  components,
  materials,
  material_substances,
  svhc_substances,
  exemptions,
  applied_exemptions,
  declarations,
  suppliers,
  declaration_requests,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const generateSchema = z.object({
  workspace_id: z.string().min(1),
  type: z.enum(['portfolio', 'scip', 'exemption-expiry', 'supplier-coverage']),
})

const TYPE_TITLES: Record<string, string> = {
  portfolio: 'Portfolio Compliance Report',
  scip: 'SCIP Readiness Report',
  'exemption-expiry': 'Exemption Expiry Report',
  'supplier-coverage': 'Supplier Coverage Report',
}

// GET / — report history (?workspace_id)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(reports)
        .where(eq(reports.workspace_id, workspaceId))
        .orderBy(desc(reports.created_at))
    : await db.select().from(reports).orderBy(desc(reports.created_at))
  return c.json(rows)
})

// GET /:id — report detail
router.get('/:id', async (c) => {
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  return c.json(r)
})

// ---------------------------------------------------------------------------
// Payload builders — each produces the jsonb payload for a report type
// ---------------------------------------------------------------------------

async function buildPortfolio(workspaceId: string) {
  const ps = await db.select().from(products).where(eq(products.workspace_id, workspaceId))
  const counts = { total: ps.length, compliant: 0, non_compliant: 0, at_risk: 0, incomplete: 0 }
  for (const p of ps) {
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
    }
  }
  return {
    counts,
    products: ps.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      part_number: p.part_number,
      market_region: p.market_region,
      lifecycle_status: p.lifecycle_status,
      compliance_status: p.compliance_status,
    })),
  }
}

async function buildScip(workspaceId: string) {
  const ps = await db.select().from(products).where(eq(products.workspace_id, workspaceId))
  const wsComponents = await db
    .select()
    .from(components)
    .where(eq(components.workspace_id, workspaceId))
  const componentIds = new Set(wsComponents.map((x) => x.id))
  const compById = new Map(wsComponents.map((x) => [x.id, x]))

  const allMaterials = wsComponents.length ? await db.select().from(materials) : []
  const wsMaterials = allMaterials.filter((m) => componentIds.has(m.component_id))
  const materialIds = new Set(wsMaterials.map((m) => m.id))
  const matById = new Map(wsMaterials.map((m) => [m.id, m]))

  const allMatSub = wsMaterials.length ? await db.select().from(material_substances) : []
  const wsMatSub = allMatSub.filter((s) => materialIds.has(s.material_id))

  const svhc = await db.select().from(svhc_substances)
  const svhcByCas = new Map<string, (typeof svhc)[number]>()
  for (const s of svhc) if (s.cas_number) svhcByCas.set(s.cas_number, s)

  // Articles requiring SCIP notification: SVHC present above article threshold (0.1%).
  const articles: Array<{
    componentId: string
    componentName: string
    materialName: string
    substance: string
    cas: string | null
    concentration_ppm: number
  }> = []
  for (const ms of wsMatSub) {
    if (!ms.cas_number) continue
    const match = svhcByCas.get(ms.cas_number)
    if (!match) continue
    const threshold = match.article_threshold_ppm ?? 1000
    if ((ms.concentration_ppm ?? 0) <= threshold) continue
    const mat = matById.get(ms.material_id)
    const comp = mat ? compById.get(mat.component_id) : undefined
    articles.push({
      componentId: comp?.id ?? '',
      componentName: comp?.name ?? 'Unknown',
      materialName: mat?.name ?? 'Unknown',
      substance: match.name,
      cas: ms.cas_number,
      concentration_ppm: ms.concentration_ppm ?? 0,
    })
  }
  return {
    productCount: ps.length,
    articleCount: articles.length,
    notificationRequired: articles.length > 0,
    articles,
  }
}

async function buildExemptionExpiry(workspaceId: string) {
  const wsApplied = await db
    .select()
    .from(applied_exemptions)
    .where(eq(applied_exemptions.workspace_id, workspaceId))
  const allExemptions = await db.select().from(exemptions)
  const exById = new Map(allExemptions.map((e) => [e.id, e]))
  const now = Date.now()
  const DAY = 86_400_000
  const items = wsApplied
    .map((ae) => {
      const ex = exById.get(ae.exemption_id)
      if (!ex) return null
      const days = ex.expiry_date ? Math.round((ex.expiry_date.getTime() - now) / DAY) : null
      return {
        appliedId: ae.id,
        exemptionNumber: ex.exemption_number,
        description: ex.description,
        substance: ex.substance_name,
        componentId: ae.component_id,
        materialId: ae.material_id,
        expiryDate: ex.expiry_date ? ex.expiry_date.toISOString() : null,
        daysToExpiry: days,
        status: days === null ? 'no_expiry' : days < 0 ? 'expired' : days <= 90 ? 'expiring' : 'active',
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      if (a.daysToExpiry === null) return 1
      if (b.daysToExpiry === null) return -1
      return a.daysToExpiry - b.daysToExpiry
    })
  return {
    total: items.length,
    expired: items.filter((i) => i.status === 'expired').length,
    expiring: items.filter((i) => i.status === 'expiring').length,
    items,
  }
}

async function buildSupplierCoverage(workspaceId: string) {
  const wsSuppliers = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.workspace_id, workspaceId))
  const wsComponents = await db
    .select()
    .from(components)
    .where(eq(components.workspace_id, workspaceId))
  const wsDeclarations = await db
    .select()
    .from(declarations)
    .where(eq(declarations.workspace_id, workspaceId))
  const wsRequests = await db
    .select()
    .from(declaration_requests)
    .where(eq(declaration_requests.workspace_id, workspaceId))

  const partsBySupplier = new Map<string, number>()
  for (const comp of wsComponents) {
    if (!comp.supplier_id) continue
    partsBySupplier.set(comp.supplier_id, (partsBySupplier.get(comp.supplier_id) ?? 0) + 1)
  }
  const declBySupplier = new Map<string, number>()
  for (const d of wsDeclarations) {
    if (!d.supplier_id) continue
    declBySupplier.set(d.supplier_id, (declBySupplier.get(d.supplier_id) ?? 0) + 1)
  }
  const reqBySupplier = new Map<string, { requested: number; received: number }>()
  for (const r of wsRequests) {
    if (!r.supplier_id) continue
    const entry = reqBySupplier.get(r.supplier_id) ?? { requested: 0, received: 0 }
    entry.requested += 1
    if (r.status === 'received' || r.status === 'closed') entry.received += 1
    reqBySupplier.set(r.supplier_id, entry)
  }

  const suppliersOut = wsSuppliers.map((s) => {
    const parts = partsBySupplier.get(s.id) ?? 0
    const decls = declBySupplier.get(s.id) ?? 0
    const req = reqBySupplier.get(s.id) ?? { requested: 0, received: 0 }
    const coveragePct = parts > 0 ? Math.round((decls / parts) * 10000) / 100 : 0
    return {
      supplierId: s.id,
      name: s.name,
      region: s.region,
      responsivenessScore: s.responsiveness_score ?? 0,
      partsSupplied: parts,
      declarationsOnFile: decls,
      coveragePct,
      requested: req.requested,
      received: req.received,
      outstanding: req.requested - req.received,
    }
  })
  const totalParts = suppliersOut.reduce((a, b) => a + b.partsSupplied, 0)
  const totalDecls = suppliersOut.reduce((a, b) => a + b.declarationsOnFile, 0)
  return {
    supplierCount: suppliersOut.length,
    overallCoveragePct: totalParts > 0 ? Math.round((totalDecls / totalParts) * 10000) / 100 : 0,
    suppliers: suppliersOut.sort((a, b) => b.coveragePct - a.coveragePct),
  }
}

// POST /generate — generate + persist a report
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, type } = c.req.valid('json')

  let payload: Record<string, unknown>
  switch (type) {
    case 'portfolio':
      payload = await buildPortfolio(workspace_id)
      break
    case 'scip':
      payload = await buildScip(workspace_id)
      break
    case 'exemption-expiry':
      payload = await buildExemptionExpiry(workspace_id)
      break
    case 'supplier-coverage':
      payload = await buildSupplierCoverage(workspace_id)
      break
    default:
      return c.json({ error: 'Unknown report type' }, 400)
  }

  const [report] = await db
    .insert(reports)
    .values({
      workspace_id,
      type,
      title: `${TYPE_TITLES[type]} — ${new Date().toISOString().slice(0, 10)}`,
      payload,
      owner_id: userId,
    })
    .returning()
  return c.json(report, 201)
})

// DELETE /:id — auth(owner) — delete a report
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(reports).where(eq(reports.id, id))
  return c.json({ success: true })
})

export default router
