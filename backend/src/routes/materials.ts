import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { materials, material_substances, components } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId, userCanAccessWorkspace } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers — ownership flows through the parent component's owner_id
// ---------------------------------------------------------------------------

async function getComponentForMaterial(materialId: string) {
  const [material] = await db.select().from(materials).where(eq(materials.id, materialId))
  if (!material) return null
  const [component] = await db
    .select()
    .from(components)
    .where(eq(components.id, material.component_id))
  if (!component) return null
  return { material, component }
}

// ---------------------------------------------------------------------------
// Materials of a component
// ---------------------------------------------------------------------------

// Auth: list materials of a component
router.get('/component/:componentId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const componentId = c.req.param('componentId')
  const [component] = await db.select().from(components).where(eq(components.id, componentId))
  if (!component) return c.json({ error: 'Component not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, component.workspace_id))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(materials)
    .where(eq(materials.component_id, componentId))
    .orderBy(materials.created_at)
  return c.json(rows)
})

const materialSchema = z.object({
  name: z.string().min(1),
  mass_grams: z.number().optional(),
  is_homogeneous: z.boolean().optional(),
})

// Auth: add a material to a component
router.post(
  '/component/:componentId',
  authMiddleware,
  zValidator('json', materialSchema),
  async (c) => {
    const userId = getUserId(c)
    const componentId = c.req.param('componentId')
    const [component] = await db.select().from(components).where(eq(components.id, componentId))
    if (!component) return c.json({ error: 'Component not found' }, 404)
    if (component.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [created] = await db
      .insert(materials)
      .values({
        component_id: componentId,
        name: body.name,
        mass_grams: body.mass_grams ?? 0,
        is_homogeneous: body.is_homogeneous ?? true,
      })
      .returning()
    return c.json(created, 201)
  },
)

// Auth: update a material
router.put('/:id', authMiddleware, zValidator('json', materialSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const ctx = await getComponentForMaterial(id)
  if (!ctx) return c.json({ error: 'Not found' }, 404)
  if (ctx.component.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.mass_grams !== undefined) patch.mass_grams = body.mass_grams
  if (body.is_homogeneous !== undefined) patch.is_homogeneous = body.is_homogeneous

  const [updated] = await db.update(materials).set(patch).where(eq(materials.id, id)).returning()
  return c.json(updated)
})

// Auth: delete a material (and its substance composition rows)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const ctx = await getComponentForMaterial(id)
  if (!ctx) return c.json({ error: 'Not found' }, 404)
  if (ctx.component.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(material_substances).where(eq(material_substances.material_id, id))
  await db.delete(materials).where(eq(materials.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Substance composition rows
// ---------------------------------------------------------------------------

// Auth: substance composition of a material
router.get('/:id/substances', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const ctx = await getComponentForMaterial(id)
  if (!ctx) return c.json({ error: 'Not found' }, 404)
  if (!(await userCanAccessWorkspace(userId, ctx.component.workspace_id))) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(material_substances)
    .where(eq(material_substances.material_id, id))
    .orderBy(material_substances.created_at)
  return c.json(rows)
})

const substanceSchema = z.object({
  substance_name: z.string().min(1),
  cas_number: z.string().optional().nullable(),
  concentration_ppm: z.number().optional(),
})

// Auth: add a substance row to a material
router.post(
  '/:id/substances',
  authMiddleware,
  zValidator('json', substanceSchema),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const ctx = await getComponentForMaterial(id)
    if (!ctx) return c.json({ error: 'Material not found' }, 404)
    if (ctx.component.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [created] = await db
      .insert(material_substances)
      .values({
        material_id: id,
        substance_name: body.substance_name,
        cas_number: body.cas_number ?? null,
        concentration_ppm: body.concentration_ppm ?? 0,
      })
      .returning()
    return c.json(created, 201)
  },
)

// Auth: delete a substance composition row
router.delete('/substances/:substanceId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const substanceId = c.req.param('substanceId')
  const [row] = await db
    .select()
    .from(material_substances)
    .where(eq(material_substances.id, substanceId))
  if (!row) return c.json({ error: 'Not found' }, 404)

  const ctx = await getComponentForMaterial(row.material_id)
  if (!ctx) return c.json({ error: 'Not found' }, 404)
  if (ctx.component.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(material_substances).where(eq(material_substances.id, substanceId))
  return c.json({ success: true })
})

export default router
