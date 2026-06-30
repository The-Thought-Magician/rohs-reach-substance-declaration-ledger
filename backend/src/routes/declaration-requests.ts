import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { declaration_requests, suppliers } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const requestSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().optional().nullable(),
  component_id: z.string().optional().nullable(),
  product_id: z.string().optional().nullable(),
  status: z.string().optional(),
  due_date: z.string().optional().nullable(),
})

const updateSchema = z.object({
  status: z.string().optional(),
  supplier_id: z.string().optional().nullable(),
  component_id: z.string().optional().nullable(),
  product_id: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
})

const bulkSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().optional().nullable(),
  product_id: z.string().optional().nullable(),
  component_ids: z.array(z.string()).min(1),
  due_date: z.string().optional().nullable(),
})

function toDate(v: string | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t)
}

// Statuses that count as "returned/received".
const RECEIVED_STATUSES = new Set(['received', 'completed', 'fulfilled', 'closed'])

// GET / — public — request ledger (?workspace_id, ?status, ?supplier_id)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const status = c.req.query('status')
  const supplierId = c.req.query('supplier_id')

  const conds = []
  if (workspaceId) conds.push(eq(declaration_requests.workspace_id, workspaceId))
  if (status) conds.push(eq(declaration_requests.status, status))
  if (supplierId) conds.push(eq(declaration_requests.supplier_id, supplierId))

  const rows = conds.length
    ? await db
        .select()
        .from(declaration_requests)
        .where(and(...conds))
        .orderBy(desc(declaration_requests.created_at))
    : await db.select().from(declaration_requests).orderBy(desc(declaration_requests.created_at))
  return c.json(rows)
})

// GET /ledger — public — who-has-and-hasn't-returned summary grouped by supplier
router.get('/ledger', async (c) => {
  const workspaceId = c.req.query('workspace_id')

  const rows = workspaceId
    ? await db
        .select()
        .from(declaration_requests)
        .where(eq(declaration_requests.workspace_id, workspaceId))
    : await db.select().from(declaration_requests)

  const supplierRows = workspaceId
    ? await db.select().from(suppliers).where(eq(suppliers.workspace_id, workspaceId))
    : await db.select().from(suppliers)
  const supplierById = new Map(supplierRows.map((s) => [s.id, s]))

  type Agg = { supplier: unknown; requested: number; received: number; outstanding: number }
  const bySupplierMap = new Map<string, Agg>()

  for (const r of rows) {
    const key = r.supplier_id ?? 'unassigned'
    let agg = bySupplierMap.get(key)
    if (!agg) {
      agg = {
        supplier: r.supplier_id ? supplierById.get(r.supplier_id) ?? { id: r.supplier_id } : null,
        requested: 0,
        received: 0,
        outstanding: 0,
      }
      bySupplierMap.set(key, agg)
    }
    agg.requested += 1
    if (RECEIVED_STATUSES.has(r.status)) agg.received += 1
    else agg.outstanding += 1
  }

  return c.json({ bySupplier: Array.from(bySupplierMap.values()) })
})

// POST / — auth — create request
router.post('/', authMiddleware, zValidator('json', requestSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(declaration_requests)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id ?? null,
      component_id: body.component_id ?? null,
      product_id: body.product_id ?? null,
      status: body.status ?? 'requested',
      due_date: toDate(body.due_date),
      owner_id: userId,
    })
    .returning()
  return c.json(created, 201)
})

// POST /bulk — auth — bulk create across BOM/supplier
router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const due = toDate(body.due_date)

  const values = body.component_ids.map((componentId) => ({
    workspace_id: body.workspace_id,
    supplier_id: body.supplier_id ?? null,
    component_id: componentId,
    product_id: body.product_id ?? null,
    status: 'requested',
    due_date: due,
    owner_id: userId,
  }))

  const requests = await db.insert(declaration_requests).values(values).returning()
  return c.json({ created: requests.length, requests }, 201)
})

// PUT /:id — auth(owner) — update status
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(declaration_requests)
    .where(eq(declaration_requests.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id
  if (body.component_id !== undefined) patch.component_id = body.component_id
  if (body.product_id !== undefined) patch.product_id = body.product_id
  if (body.due_date !== undefined) patch.due_date = toDate(body.due_date)

  const [updated] = await db
    .update(declaration_requests)
    .set(patch)
    .where(eq(declaration_requests.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/remind — auth — increment reminder + set last_reminded_at
router.post('/:id/remind', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(declaration_requests)
    .where(eq(declaration_requests.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(declaration_requests)
    .set({
      reminder_count: (existing.reminder_count ?? 0) + 1,
      last_reminded_at: new Date(),
      status: RECEIVED_STATUSES.has(existing.status) ? existing.status : 'reminded',
    })
    .where(eq(declaration_requests.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth(owner) — delete
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(declaration_requests)
    .where(eq(declaration_requests.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(declaration_requests).where(eq(declaration_requests.id, id))
  return c.json({ success: true })
})

export default router
