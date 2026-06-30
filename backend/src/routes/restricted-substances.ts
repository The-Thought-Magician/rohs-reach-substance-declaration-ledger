import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { restricted_substances } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const restrictedSchema = z.object({
  name: z.string().min(1),
  cas_number: z.string().optional().nullable(),
  ec_number: z.string().optional().nullable(),
  max_concentration_ppm: z.number().nonnegative(),
  threshold_basis: z.string().optional(),
  restriction_basis: z.string().optional().nullable(),
  list_version: z.string().optional(),
})

// Public: RoHS restricted-substance catalog
router.get('/', async (c) => {
  const all = await db
    .select()
    .from(restricted_substances)
    .orderBy(restricted_substances.name)
  return c.json(all)
})

// Public: detail
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(restricted_substances)
    .where(eq(restricted_substances.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Auth: add restricted substance
router.post('/', authMiddleware, zValidator('json', restrictedSchema), async (c) => {
  getUserId(c)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(restricted_substances)
    .values({
      name: body.name,
      cas_number: body.cas_number ?? null,
      ec_number: body.ec_number ?? null,
      max_concentration_ppm: body.max_concentration_ppm,
      threshold_basis: body.threshold_basis ?? 'homogeneous_material',
      restriction_basis: body.restriction_basis ?? null,
      list_version: body.list_version ?? 'RoHS3',
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update threshold/metadata
router.put('/:id', authMiddleware, zValidator('json', restrictedSchema.partial()), async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(restricted_substances)
    .where(eq(restricted_substances.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(restricted_substances)
    .set(body)
    .where(eq(restricted_substances.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete
router.delete('/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(restricted_substances)
    .where(eq(restricted_substances.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(restricted_substances).where(eq(restricted_substances.id, id))
  return c.json({ success: true })
})

export default router
