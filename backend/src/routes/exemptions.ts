import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { exemptions, applied_exemptions } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const exemptionSchema = z.object({
  exemption_number: z.string().min(1),
  description: z.string().min(1),
  scope: z.string().optional().nullable(),
  substance_name: z.string().optional().nullable(),
  expiry_date: z.string().datetime().optional().nullable(),
})

const appliedSchema = z.object({
  workspace_id: z.string().min(1),
  exemption_id: z.string().min(1),
  component_id: z.string().optional().nullable(),
  material_id: z.string().optional().nullable(),
  justification: z.string().optional().nullable(),
})

// Public: exemption catalog
router.get('/', async (c) => {
  const all = await db.select().from(exemptions).orderBy(exemptions.exemption_number)
  return c.json(all)
})

// Public: exemptions expiring within a window (?days=90) + affected applied rows
router.get('/expiring', async (c) => {
  const days = parseInt(c.req.query('days') ?? '90', 10)
  const horizonDays = Number.isFinite(days) && days > 0 ? days : 90
  const now = Date.now()
  const horizon = now + horizonDays * 86_400_000

  const all = await db.select().from(exemptions)
  const expiringList = all.filter((e) => {
    if (!e.expiry_date) return false
    const t = new Date(e.expiry_date).getTime()
    return t >= now && t <= horizon
  })

  const expiringIds = new Set(expiringList.map((e) => e.id))
  let applied: Array<typeof applied_exemptions.$inferSelect> = []
  if (expiringIds.size > 0) {
    const allApplied = await db.select().from(applied_exemptions)
    applied = allApplied.filter((a) => expiringIds.has(a.exemption_id))
  }

  return c.json({ exemptions: expiringList, applied })
})

// Public: applied exemptions (?workspace_id)
router.get('/applied', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(applied_exemptions)
        .where(eq(applied_exemptions.workspace_id, workspaceId))
        .orderBy(applied_exemptions.created_at)
    : await db.select().from(applied_exemptions).orderBy(applied_exemptions.created_at)
  return c.json(rows)
})

// Auth: apply an exemption to a component/material
router.post('/applied', authMiddleware, zValidator('json', appliedSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Validate the referenced exemption exists.
  const [exemption] = await db
    .select()
    .from(exemptions)
    .where(eq(exemptions.id, body.exemption_id))
  if (!exemption) return c.json({ error: 'Exemption not found' }, 404)

  const [row] = await db
    .insert(applied_exemptions)
    .values({
      workspace_id: body.workspace_id,
      exemption_id: body.exemption_id,
      component_id: body.component_id ?? null,
      material_id: body.material_id ?? null,
      justification: body.justification ?? null,
      owner_id: userId,
    })
    .returning()
  return c.json(row, 201)
})

// Auth: remove an applied exemption (owner check)
router.delete('/applied/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(applied_exemptions)
    .where(eq(applied_exemptions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(applied_exemptions).where(eq(applied_exemptions.id, id))
  return c.json({ success: true })
})

// Auth: add exemption to catalog
router.post('/', authMiddleware, zValidator('json', exemptionSchema), async (c) => {
  getUserId(c)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(exemptions)
    .values({
      exemption_number: body.exemption_number,
      description: body.description,
      scope: body.scope ?? null,
      substance_name: body.substance_name ?? null,
      expiry_date: body.expiry_date ? new Date(body.expiry_date) : null,
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update exemption
router.put('/:id', authMiddleware, zValidator('json', exemptionSchema.partial()), async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exemptions).where(eq(exemptions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.exemption_number !== undefined) patch.exemption_number = body.exemption_number
  if (body.description !== undefined) patch.description = body.description
  if (body.scope !== undefined) patch.scope = body.scope ?? null
  if (body.substance_name !== undefined) patch.substance_name = body.substance_name ?? null
  if (body.expiry_date !== undefined)
    patch.expiry_date = body.expiry_date ? new Date(body.expiry_date) : null
  const [updated] = await db
    .update(exemptions)
    .set(patch)
    .where(eq(exemptions.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete exemption
router.delete('/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exemptions).where(eq(exemptions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(exemptions).where(eq(exemptions.id, id))
  return c.json({ success: true })
})

export default router
