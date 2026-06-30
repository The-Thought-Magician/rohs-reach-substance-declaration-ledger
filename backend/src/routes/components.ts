import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { components, materials, material_substances } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Catalog list with substance / supplier filters
// ---------------------------------------------------------------------------

// Public: list components for a workspace, with optional supplier and
// substance-CAS filters. ?workspace_id, ?supplier_id, ?substance_cas
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const supplierId = c.req.query('supplier_id')
  const substanceCas = c.req.query('substance_cas')

  const conditions = []
  if (workspaceId) conditions.push(eq(components.workspace_id, workspaceId))
  if (supplierId) conditions.push(eq(components.supplier_id, supplierId))

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(components)
          .where(and(...conditions))
          .orderBy(desc(components.created_at))
      : await db.select().from(components).orderBy(desc(components.created_at))

  if (!substanceCas) return c.json(rows)

  // Filter to components that contain a material with the given substance CAS.
  if (rows.length === 0) return c.json([])
  const componentIds = rows.map((r) => r.id)
  const mats = await db
    .select()
    .from(materials)
    .where(inArray(materials.component_id, componentIds))
  if (mats.length === 0) return c.json([])
  const materialIds = mats.map((m) => m.id)
  const subs = await db
    .select()
    .from(material_substances)
    .where(
      and(
        inArray(material_substances.material_id, materialIds),
        eq(material_substances.cas_number, substanceCas),
      ),
    )
  const matToComponent = new Map(mats.map((m) => [m.id, m.component_id]))
  const matchingComponentIds = new Set(
    subs.map((s) => matToComponent.get(s.material_id)).filter((x): x is string => !!x),
  )
  return c.json(rows.filter((r) => matchingComponentIds.has(r.id)))
})

// Public: component detail + its materials
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [component] = await db.select().from(components).where(eq(components.id, id))
  if (!component) return c.json({ error: 'Not found' }, 404)
  const mats = await db
    .select()
    .from(materials)
    .where(eq(materials.component_id, id))
    .orderBy(materials.created_at)
  return c.json({ component, materials: mats })
})

const componentSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  manufacturer_part_number: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  supplier_id: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  mass_grams: z.number().optional(),
})

// Auth: create a component
router.post('/', authMiddleware, zValidator('json', componentSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(components)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      manufacturer_part_number: body.manufacturer_part_number ?? null,
      description: body.description ?? null,
      supplier_id: body.supplier_id ?? null,
      manufacturer: body.manufacturer ?? null,
      mass_grams: body.mass_grams ?? 0,
      owner_id: userId,
    })
    .returning()
  return c.json(created, 201)
})

// Auth(owner): update a component
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', componentSchema.partial().omit({ workspace_id: true })),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(components).where(eq(components.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.manufacturer_part_number !== undefined)
      patch.manufacturer_part_number = body.manufacturer_part_number
    if (body.description !== undefined) patch.description = body.description
    if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id
    if (body.manufacturer !== undefined) patch.manufacturer = body.manufacturer
    if (body.mass_grams !== undefined) patch.mass_grams = body.mass_grams

    const [updated] = await db
      .update(components)
      .set(patch)
      .where(eq(components.id, id))
      .returning()
    return c.json(updated)
  },
)

// Auth(owner): delete a component (and its materials + substance rows)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(components).where(eq(components.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const mats = await db.select().from(materials).where(eq(materials.component_id, id))
  if (mats.length > 0) {
    const materialIds = mats.map((m) => m.id)
    await db
      .delete(material_substances)
      .where(inArray(material_substances.material_id, materialIds))
    await db.delete(materials).where(eq(materials.component_id, id))
  }
  await db.delete(components).where(eq(components.id, id))
  return c.json({ success: true })
})

export default router
