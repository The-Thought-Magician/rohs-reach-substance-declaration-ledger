import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// GET / — current user's notification feed. Reads the user via getUserId
// (the proxy always injects X-User-Id); empty feed if no user resolved.
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const feed = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
  return c.json(feed)
})

// POST /:id/read — mark a single notification read (owner only).
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// POST /read-all — mark all of the current user's notifications read.
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const updated = await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)))
    .returning()
  return c.json({ updated: updated.length })
})

// DELETE /:id — delete a notification (owner only).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(notifications).where(eq(notifications.id, id))
  return c.json({ success: true })
})

export default router
