import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { declarations, declaration_substances } from '../db/schema.js'
import { authMiddleware, getUserId, userCanAccessWorkspace } from '../lib/auth.js'

const router = new Hono()

const declarationSchema = z.object({
  workspace_id: z.string().min(1),
  supplier_id: z.string().optional().nullable(),
  component_id: z.string().optional().nullable(),
  format: z.string().optional(),
  status: z.string().optional(),
  document_url: z.string().optional().nullable(),
  valid_from: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
  confidence: z.string().optional(),
  superseded_by: z.string().optional().nullable(),
})

const declarationUpdateSchema = z.object({
  supplier_id: z.string().optional().nullable(),
  component_id: z.string().optional().nullable(),
  format: z.string().optional(),
  status: z.string().optional(),
  document_url: z.string().optional().nullable(),
  valid_from: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
  confidence: z.string().optional(),
  superseded_by: z.string().optional().nullable(),
})

const substanceSchema = z.object({
  material_name: z.string().optional().nullable(),
  substance_name: z.string().min(1),
  cas_number: z.string().optional().nullable(),
  concentration_ppm: z.number().nonnegative().optional().default(0),
})

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t)
}

// GET / — auth — declarations (?workspace_id required, ?component_id, ?supplier_id, ?status)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!(await userCanAccessWorkspace(userId, workspaceId))) return c.json({ error: 'Forbidden' }, 403)
  const componentId = c.req.query('component_id')
  const supplierId = c.req.query('supplier_id')
  const status = c.req.query('status')

  const conds = [eq(declarations.workspace_id, workspaceId)]
  if (componentId) conds.push(eq(declarations.component_id, componentId))
  if (supplierId) conds.push(eq(declarations.supplier_id, supplierId))
  if (status) conds.push(eq(declarations.status, status))

  const rows = await db.select().from(declarations).where(and(...conds)).orderBy(desc(declarations.created_at))
  return c.json(rows)
})

// GET /stale?days=365 — auth — declarations stale/expiring (?workspace_id required)
router.get('/stale', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const days = parseInt(c.req.query('days') ?? '365', 10)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!(await userCanAccessWorkspace(userId, workspaceId))) return c.json({ error: 'Forbidden' }, 403)
  const now = Date.now()
  const windowMs = (Number.isFinite(days) ? days : 365) * 86_400_000
  const threshold = now + windowMs

  const rows = await db.select().from(declarations).where(eq(declarations.workspace_id, workspaceId))

  const stale = rows.filter((d) => {
    // Expiring: valid_until within the window (or already past).
    if (d.valid_until) {
      const vu = new Date(d.valid_until as unknown as string).getTime()
      if (vu <= threshold) return true
    }
    // Stale by age: created longer than `days` ago and no valid_until set.
    if (!d.valid_until && d.created_at) {
      const created = new Date(d.created_at as unknown as string).getTime()
      if (now - created >= windowMs) return true
    }
    return false
  })

  return c.json(stale)
})

// GET /:id — auth — declaration + captured substances
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [declaration] = await db.select().from(declarations).where(eq(declarations.id, id))
  if (!declaration) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, declaration.workspace_id))) return c.json({ error: 'Forbidden' }, 403)
  const substances = await db
    .select()
    .from(declaration_substances)
    .where(eq(declaration_substances.declaration_id, id))
    .orderBy(declaration_substances.created_at)
  return c.json({ declaration, substances })
})

// POST / — auth — create/intake declaration
router.post('/', authMiddleware, zValidator('json', declarationSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(declarations)
    .values({
      workspace_id: body.workspace_id,
      supplier_id: body.supplier_id ?? null,
      component_id: body.component_id ?? null,
      format: body.format ?? 'IPC-1752A',
      status: body.status ?? 'received',
      document_url: body.document_url ?? null,
      valid_from: toDate(body.valid_from) ?? null,
      valid_until: toDate(body.valid_until) ?? null,
      confidence: body.confidence ?? 'medium',
      superseded_by: body.superseded_by ?? null,
      owner_id: userId,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — auth(owner) — update (status, validity, supersede)
router.put('/:id', authMiddleware, zValidator('json', declarationUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(declarations).where(eq(declarations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id
  if (body.component_id !== undefined) patch.component_id = body.component_id
  if (body.format !== undefined) patch.format = body.format
  if (body.status !== undefined) patch.status = body.status
  if (body.document_url !== undefined) patch.document_url = body.document_url
  if (body.valid_from !== undefined) patch.valid_from = toDate(body.valid_from)
  if (body.valid_until !== undefined) patch.valid_until = toDate(body.valid_until)
  if (body.confidence !== undefined) patch.confidence = body.confidence
  if (body.superseded_by !== undefined) patch.superseded_by = body.superseded_by

  const [updated] = await db
    .update(declarations)
    .set(patch)
    .where(eq(declarations.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth(owner) — delete
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(declarations).where(eq(declarations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(declaration_substances).where(eq(declaration_substances.declaration_id, id))
  await db.delete(declarations).where(eq(declarations.id, id))
  return c.json({ success: true })
})

// POST /:id/substances — auth — add captured substance row
router.post('/:id/substances', authMiddleware, zValidator('json', substanceSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [declaration] = await db.select().from(declarations).where(eq(declarations.id, id))
  if (!declaration) return c.json({ error: 'Not found' }, 404)
  if (declaration.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [created] = await db
    .insert(declaration_substances)
    .values({
      declaration_id: id,
      material_name: body.material_name ?? null,
      substance_name: body.substance_name,
      cas_number: body.cas_number ?? null,
      concentration_ppm: body.concentration_ppm ?? 0,
    })
    .returning()
  return c.json(created, 201)
})

// DELETE /substances/:substanceId — auth — delete substance row
router.delete('/substances/:substanceId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const substanceId = c.req.param('substanceId')
  const [row] = await db
    .select()
    .from(declaration_substances)
    .where(eq(declaration_substances.id, substanceId))
  if (!row) return c.json({ error: 'Not found' }, 404)
  const [declaration] = await db
    .select()
    .from(declarations)
    .where(eq(declarations.id, row.declaration_id))
  if (declaration && declaration.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(declaration_substances).where(eq(declaration_substances.id, substanceId))
  return c.json({ success: true })
})

export default router
