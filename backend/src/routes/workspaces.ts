import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, or, inArray, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const workspaceSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  market_regions: z.array(z.string()).optional(),
  default_thresholds: z.record(z.string(), z.number()).optional(),
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.string().min(1).optional().default('member'),
})

// Public: list workspaces the current user owns or is a member of.
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])

  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const memberWorkspaceIds = memberships.map((m) => m.workspace_id)

  const owned = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))

  const memberRows =
    memberWorkspaceIds.length > 0
      ? await db.select().from(workspaces).where(inArray(workspaces.id, memberWorkspaceIds))
      : []

  // De-duplicate by id.
  const byId = new Map<string, (typeof owned)[number]>()
  for (const w of [...owned, ...memberRows]) byId.set(w.id, w)
  const all = Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  return c.json(all)
})

// Public: workspace detail.
router.get('/:id', async (c) => {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, c.req.param('id')))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json(ws)
})

// Public: list members.
router.get('/:id/members', async (c) => {
  const id = c.req.param('id')
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(workspace_members.created_at)
  return c.json(members)
})

// Auth: create workspace + insert owner membership.
router.post('/', authMiddleware, zValidator('json', workspaceSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      company: body.company,
      market_regions: body.market_regions ?? [],
      default_thresholds: body.default_thresholds ?? {},
      owner_id: userId,
    })
    .returning()

  await db
    .insert(workspace_members)
    .values({ workspace_id: ws.id, user_id: userId, role: 'owner' })
    .onConflictDoNothing()

  return c.json(ws, 201)
})

// Auth(owner): update workspace settings.
router.put('/:id', authMiddleware, zValidator('json', workspaceSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// Auth(owner): add member.
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, id),
        eq(workspace_members.user_id, body.user_id),
      ),
    )
  if (existing) {
    const [updated] = await db
      .update(workspace_members)
      .set({ role: body.role })
      .where(eq(workspace_members.id, existing.id))
      .returning()
    return c.json(updated)
  }

  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role })
    .returning()
  return c.json(member, 201)
})

// Auth(owner): remove member.
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!member) return c.json({ error: 'Not found' }, 404)

  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  return c.json({ success: true })
})

export default router
