import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { tasks, audit_events } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  product_id: z.string().optional().nullable(),
  component_id: z.string().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(['open', 'in_progress', 'blocked', 'done']).optional().default('open'),
  assignee_id: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  offending_substance: z.string().optional().nullable(),
})

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(['open', 'in_progress', 'blocked', 'done']).optional(),
  assignee_id: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  product_id: z.string().optional().nullable(),
  component_id: z.string().optional().nullable(),
  offending_substance: z.string().optional().nullable(),
})

// Public: list tasks (?workspace_id, ?status, ?product_id)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const status = c.req.query('status')
  const productId = c.req.query('product_id')

  const conds = []
  if (workspaceId) conds.push(eq(tasks.workspace_id, workspaceId))
  if (status) conds.push(eq(tasks.status, status))
  if (productId) conds.push(eq(tasks.product_id, productId))

  const rows = conds.length
    ? await db
        .select()
        .from(tasks)
        .where(and(...conds))
        .orderBy(desc(tasks.created_at))
    : await db.select().from(tasks).orderBy(desc(tasks.created_at))

  return c.json(rows)
})

// Public: task detail
router.get('/:id', async (c) => {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, c.req.param('id')))
  if (!task) return c.json({ error: 'Not found' }, 404)
  return c.json(task)
})

// Auth: create remediation task
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [task] = await db
    .insert(tasks)
    .values({
      workspace_id: body.workspace_id,
      product_id: body.product_id ?? null,
      component_id: body.component_id ?? null,
      title: body.title,
      description: body.description ?? null,
      status: body.status ?? 'open',
      assignee_id: body.assignee_id ?? null,
      due_date: body.due_date ? new Date(body.due_date) : null,
      offending_substance: body.offending_substance ?? null,
      owner_id: userId,
    })
    .returning()

  await db.insert(audit_events).values({
    workspace_id: body.workspace_id,
    user_id: userId,
    action: 'task.create',
    entity_type: 'task',
    entity_id: task.id,
    metadata: { title: task.title, product_id: task.product_id },
  })

  return c.json(task, 201)
})

// Auth(owner): update task (status, assignee, due)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.status !== undefined) updates.status = body.status
  if (body.assignee_id !== undefined) updates.assignee_id = body.assignee_id
  if (body.product_id !== undefined) updates.product_id = body.product_id
  if (body.component_id !== undefined) updates.component_id = body.component_id
  if (body.offending_substance !== undefined) updates.offending_substance = body.offending_substance
  if (body.due_date !== undefined) updates.due_date = body.due_date ? new Date(body.due_date) : null

  const [updated] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning()

  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    user_id: userId,
    action: 'task.update',
    entity_type: 'task',
    entity_id: id,
    metadata: { status: updated.status, assignee_id: updated.assignee_id },
  })

  return c.json(updated)
})

// Auth(owner): delete task
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(tasks).where(eq(tasks.id, id))

  await db.insert(audit_events).values({
    workspace_id: existing.workspace_id,
    user_id: userId,
    action: 'task.delete',
    entity_type: 'task',
    entity_id: id,
    metadata: { title: existing.title },
  })

  return c.json({ success: true })
})

export default router
