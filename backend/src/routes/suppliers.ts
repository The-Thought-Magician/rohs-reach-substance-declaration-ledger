import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  suppliers,
  supplier_contacts,
  components,
  declarations,
  declaration_substances,
  declaration_requests,
  restricted_substances,
  svhc_substances,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const supplierSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().optional(),
  accepted_formats: z.array(z.string()).optional(),
  responsiveness_score: z.number().optional(),
  notes: z.string().optional(),
})

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  role: z.string().optional(),
  is_escalation: z.boolean().optional().default(false),
})

// Public: list suppliers, optionally scoped to a workspace.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.workspace_id, workspaceId))
        .orderBy(desc(suppliers.created_at))
    : await db.select().from(suppliers).orderBy(desc(suppliers.created_at))
  return c.json(rows)
})

// Public: supplier detail.
router.get('/:id', async (c) => {
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, c.req.param('id')))
  if (!s) return c.json({ error: 'Not found' }, 404)
  return c.json(s)
})

// Public: scorecard — responsiveness, declaration freshness, coverage, pass rate.
router.get('/:id/scorecard', async (c) => {
  const id = c.req.param('id')
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!supplier) return c.json({ error: 'Not found' }, 404)

  // Parts supplied by this supplier.
  const parts = await db.select().from(components).where(eq(components.supplier_id, id))
  const partsSupplied = parts.length
  const partIds = new Set(parts.map((p) => p.id))

  // Declarations on file from this supplier.
  const decls = await db.select().from(declarations).where(eq(declarations.supplier_id, id))
  const declarationsOnFile = decls.length

  // Coverage: fraction of supplied parts that have at least one declaration.
  const coveredComponentIds = new Set(
    decls.map((d) => d.component_id).filter((cid): cid is string => !!cid && partIds.has(cid)),
  )
  const coveragePct =
    partsSupplied > 0 ? Math.round((coveredComponentIds.size / partsSupplied) * 10000) / 100 : 0

  // Freshness: count of currently valid declarations (valid_until in the future or unset).
  const now = Date.now()
  const freshDeclarations = decls.filter((d) => {
    if (!d.valid_until) return true
    return new Date(d.valid_until).getTime() >= now
  }).length
  const freshnessPct =
    declarationsOnFile > 0
      ? Math.round((freshDeclarations / declarationsOnFile) * 10000) / 100
      : 0

  // Pass rate: of declarations with captured substances, how many are within thresholds.
  const restricted = await db.select().from(restricted_substances)
  const svhc = await db.select().from(svhc_substances)
  const restrictedByCas = new Map<string, number>()
  for (const r of restricted) {
    if (r.cas_number) restrictedByCas.set(r.cas_number.trim(), r.max_concentration_ppm)
  }
  const svhcByCas = new Map<string, number>()
  for (const s of svhc) {
    if (s.cas_number) svhcByCas.set(s.cas_number.trim(), s.article_threshold_ppm)
  }

  let evaluated = 0
  let passed = 0
  for (const d of decls) {
    const subs = await db
      .select()
      .from(declaration_substances)
      .where(eq(declaration_substances.declaration_id, d.id))
    if (subs.length === 0) continue
    evaluated++
    let ok = true
    for (const sub of subs) {
      const cas = sub.cas_number?.trim()
      if (!cas) continue
      const rohsMax = restrictedByCas.get(cas)
      if (rohsMax !== undefined && sub.concentration_ppm > rohsMax) {
        ok = false
        break
      }
      const reachMax = svhcByCas.get(cas)
      if (reachMax !== undefined && sub.concentration_ppm > reachMax) {
        ok = false
        break
      }
    }
    if (ok) passed++
  }
  const passRate = evaluated > 0 ? Math.round((passed / evaluated) * 10000) / 100 : 0

  // Responsiveness from declaration-request ledger: received / requested.
  const reqs = await db
    .select()
    .from(declaration_requests)
    .where(eq(declaration_requests.supplier_id, id))
  const received = reqs.filter((r) => r.status === 'received' || r.status === 'fulfilled').length
  const responsivenessPct =
    reqs.length > 0 ? Math.round((received / reqs.length) * 10000) / 100 : 0
  const avgReminders =
    reqs.length > 0
      ? Math.round((reqs.reduce((acc, r) => acc + (r.reminder_count ?? 0), 0) / reqs.length) * 100) /
        100
      : 0

  return c.json({
    supplier,
    partsSupplied,
    declarationsOnFile,
    coveragePct,
    freshnessPct,
    passRate,
    responsivenessPct,
    responsivenessScore: supplier.responsiveness_score ?? 0,
    avgReminders,
    requestsTotal: reqs.length,
    requestsReceived: received,
  })
})

// Public: list contacts.
router.get('/:id/contacts', async (c) => {
  const id = c.req.param('id')
  const rows = await db
    .select()
    .from(supplier_contacts)
    .where(eq(supplier_contacts.supplier_id, id))
    .orderBy(desc(supplier_contacts.created_at))
  return c.json(rows)
})

// Auth: create supplier.
router.post('/', authMiddleware, zValidator('json', supplierSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [s] = await db
    .insert(suppliers)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      region: body.region,
      accepted_formats: body.accepted_formats ?? [],
      responsiveness_score: body.responsiveness_score ?? 0,
      notes: body.notes,
      owner_id: userId,
    })
    .returning()
  return c.json(s, 201)
})

// Auth(owner): update supplier.
router.put('/:id', authMiddleware, zValidator('json', supplierSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(suppliers).set(body).where(eq(suppliers.id, id)).returning()
  return c.json(updated)
})

// Auth(owner): delete supplier.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(supplier_contacts).where(eq(supplier_contacts.supplier_id, id))
  await db.delete(suppliers).where(eq(suppliers.id, id))
  return c.json({ success: true })
})

// Auth: add contact.
router.post('/:id/contacts', authMiddleware, zValidator('json', contactSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!supplier) return c.json({ error: 'Not found' }, 404)
  if (supplier.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [contact] = await db
    .insert(supplier_contacts)
    .values({
      supplier_id: id,
      name: body.name,
      email: body.email || null,
      role: body.role,
      is_escalation: body.is_escalation ?? false,
    })
    .returning()
  return c.json(contact, 201)
})

// Auth: remove contact.
router.delete('/:id/contacts/:contactId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const contactId = c.req.param('contactId')
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id))
  if (!supplier) return c.json({ error: 'Not found' }, 404)
  if (supplier.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [contact] = await db
    .select()
    .from(supplier_contacts)
    .where(
      and(eq(supplier_contacts.id, contactId), eq(supplier_contacts.supplier_id, id)),
    )
  if (!contact) return c.json({ error: 'Not found' }, 404)
  await db.delete(supplier_contacts).where(eq(supplier_contacts.id, contactId))
  return c.json({ success: true })
})

export default router
