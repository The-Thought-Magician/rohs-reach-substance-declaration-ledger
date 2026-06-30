import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { bom_versions, bom_items, products, components } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getProductOwned(productId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId))
  return product ?? null
}

async function getVersionWithProduct(versionId: string) {
  const [version] = await db.select().from(bom_versions).where(eq(bom_versions.id, versionId))
  if (!version) return null
  const product = await getProductOwned(version.product_id)
  if (!product) return null
  return { version, product }
}

async function getItemContext(itemId: string) {
  const [item] = await db.select().from(bom_items).where(eq(bom_items.id, itemId))
  if (!item) return null
  const ctx = await getVersionWithProduct(item.bom_version_id)
  if (!ctx) return null
  return { item, version: ctx.version, product: ctx.product }
}

// ---------------------------------------------------------------------------
// BOM versions
// ---------------------------------------------------------------------------

// Public: list BOM versions for a product (newest first)
router.get('/product/:productId/versions', async (c) => {
  const productId = c.req.param('productId')
  const rows = await db
    .select()
    .from(bom_versions)
    .where(eq(bom_versions.product_id, productId))
    .orderBy(desc(bom_versions.created_at))
  return c.json(rows)
})

const versionSchema = z.object({
  revision: z.string().min(1),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
})

// Auth: create a new BOM version for a product
router.post(
  '/product/:productId/versions',
  authMiddleware,
  zValidator('json', versionSchema),
  async (c) => {
    const userId = getUserId(c)
    const productId = c.req.param('productId')
    const product = await getProductOwned(productId)
    if (!product) return c.json({ error: 'Product not found' }, 404)
    if (product.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [created] = await db
      .insert(bom_versions)
      .values({
        product_id: productId,
        revision: body.revision,
        notes: body.notes ?? null,
        is_active: body.is_active ?? true,
      })
      .returning()
    return c.json(created, 201)
  },
)

// Auth: clone an existing version (and its items) into a new revision
router.post(
  '/product/:productId/clone/:versionId',
  authMiddleware,
  zValidator(
    'json',
    z.object({ revision: z.string().min(1).optional(), notes: z.string().optional() }).optional(),
  ),
  async (c) => {
    const userId = getUserId(c)
    const productId = c.req.param('productId')
    const versionId = c.req.param('versionId')

    const product = await getProductOwned(productId)
    if (!product) return c.json({ error: 'Product not found' }, 404)
    if (product.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const [source] = await db
      .select()
      .from(bom_versions)
      .where(and(eq(bom_versions.id, versionId), eq(bom_versions.product_id, productId)))
    if (!source) return c.json({ error: 'Source version not found' }, 404)

    const body = (c.req.valid('json') as { revision?: string; notes?: string } | undefined) ?? {}
    const newRevision = body.revision ?? `${source.revision}-copy`

    const [clonedVersion] = await db
      .insert(bom_versions)
      .values({
        product_id: productId,
        revision: newRevision,
        notes: body.notes ?? source.notes ?? null,
        is_active: false,
      })
      .returning()

    // Clone items, preserving parent/child hierarchy via an old->new id map.
    const sourceItems = await db
      .select()
      .from(bom_items)
      .where(eq(bom_items.bom_version_id, versionId))
      .orderBy(bom_items.created_at)

    const idMap = new Map<string, string>()
    // Insert roots first, then resolve parents iteratively so parents always
    // exist in the map before their children are mapped.
    const pending = [...sourceItems]
    let guard = pending.length + 1
    while (pending.length > 0 && guard-- > 0) {
      const remaining: typeof pending = []
      for (const item of pending) {
        if (item.parent_id && !idMap.has(item.parent_id)) {
          // Parent is itself a cloned item not yet inserted — defer.
          if (sourceItems.some((s) => s.id === item.parent_id)) {
            remaining.push(item)
            continue
          }
        }
        const newParent = item.parent_id ? idMap.get(item.parent_id) ?? null : null
        const [insertedItem] = await db
          .insert(bom_items)
          .values({
            bom_version_id: clonedVersion.id,
            component_id: item.component_id,
            parent_id: newParent,
            reference: item.reference,
            quantity: item.quantity,
            mass_grams: item.mass_grams,
          })
          .returning()
        idMap.set(item.id, insertedItem.id)
      }
      if (remaining.length === pending.length) {
        // No progress (cycle / orphan parent) — flatten the rest as roots.
        for (const item of remaining) {
          const [insertedItem] = await db
            .insert(bom_items)
            .values({
              bom_version_id: clonedVersion.id,
              component_id: item.component_id,
              parent_id: null,
              reference: item.reference,
              quantity: item.quantity,
              mass_grams: item.mass_grams,
            })
            .returning()
          idMap.set(item.id, insertedItem.id)
        }
        break
      }
      pending.length = 0
      pending.push(...remaining)
    }

    return c.json(clonedVersion, 201)
  },
)

// ---------------------------------------------------------------------------
// BOM items (tree)
// ---------------------------------------------------------------------------

// Public: list items for a version (tree, ordered)
router.get('/versions/:versionId/items', async (c) => {
  const versionId = c.req.param('versionId')
  const rows = await db
    .select()
    .from(bom_items)
    .where(eq(bom_items.bom_version_id, versionId))
    .orderBy(bom_items.created_at)
  return c.json(rows)
})

const itemSchema = z.object({
  component_id: z.string().optional().nullable(),
  parent_id: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  quantity: z.number().optional(),
  mass_grams: z.number().optional(),
})

// Auth: add an item to a version
router.post(
  '/versions/:versionId/items',
  authMiddleware,
  zValidator('json', itemSchema),
  async (c) => {
    const userId = getUserId(c)
    const versionId = c.req.param('versionId')
    const ctx = await getVersionWithProduct(versionId)
    if (!ctx) return c.json({ error: 'Version not found' }, 404)
    if (ctx.product.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')

    // Validate parent belongs to the same version, if provided.
    if (body.parent_id) {
      const [parent] = await db
        .select()
        .from(bom_items)
        .where(and(eq(bom_items.id, body.parent_id), eq(bom_items.bom_version_id, versionId)))
      if (!parent) return c.json({ error: 'Parent item not in this version' }, 400)
    }

    const [created] = await db
      .insert(bom_items)
      .values({
        bom_version_id: versionId,
        component_id: body.component_id ?? null,
        parent_id: body.parent_id ?? null,
        reference: body.reference ?? null,
        quantity: body.quantity ?? 1,
        mass_grams: body.mass_grams ?? 0,
      })
      .returning()
    return c.json(created, 201)
  },
)

// Auth: update / re-parent an item
router.put('/items/:itemId', authMiddleware, zValidator('json', itemSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const itemId = c.req.param('itemId')
  const ctx = await getItemContext(itemId)
  if (!ctx) return c.json({ error: 'Item not found' }, 404)
  if (ctx.product.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')

  // Re-parent validation: parent must be in the same version, not self, and
  // must not create a cycle (new parent cannot be a descendant of the item).
  if (body.parent_id !== undefined && body.parent_id !== null) {
    if (body.parent_id === itemId) return c.json({ error: 'Item cannot be its own parent' }, 400)
    const [parent] = await db
      .select()
      .from(bom_items)
      .where(
        and(eq(bom_items.id, body.parent_id), eq(bom_items.bom_version_id, ctx.item.bom_version_id)),
      )
    if (!parent) return c.json({ error: 'Parent item not in this version' }, 400)

    // Walk up from the candidate parent; if we reach itemId it would cycle.
    const all = await db
      .select()
      .from(bom_items)
      .where(eq(bom_items.bom_version_id, ctx.item.bom_version_id))
    const byId = new Map(all.map((i) => [i.id, i]))
    let cursor: string | null = body.parent_id
    let hops = all.length + 1
    while (cursor && hops-- > 0) {
      if (cursor === itemId) return c.json({ error: 'Re-parent would create a cycle' }, 400)
      cursor = byId.get(cursor)?.parent_id ?? null
    }
  }

  const patch: Record<string, unknown> = {}
  if (body.component_id !== undefined) patch.component_id = body.component_id
  if (body.parent_id !== undefined) patch.parent_id = body.parent_id
  if (body.reference !== undefined) patch.reference = body.reference
  if (body.quantity !== undefined) patch.quantity = body.quantity
  if (body.mass_grams !== undefined) patch.mass_grams = body.mass_grams

  const [updated] = await db
    .update(bom_items)
    .set(patch)
    .where(eq(bom_items.id, itemId))
    .returning()
  return c.json(updated)
})

// Auth: delete an item (and re-parent its children to the deleted item's parent)
router.delete('/items/:itemId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const itemId = c.req.param('itemId')
  const ctx = await getItemContext(itemId)
  if (!ctx) return c.json({ error: 'Item not found' }, 404)
  if (ctx.product.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Promote children to the deleted node's parent to keep the tree connected.
  await db
    .update(bom_items)
    .set({ parent_id: ctx.item.parent_id ?? null })
    .where(eq(bom_items.parent_id, itemId))

  await db.delete(bom_items).where(eq(bom_items.id, itemId))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// CSV-mapped bulk import
// ---------------------------------------------------------------------------

const importRowSchema = z.object({
  component_id: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  quantity: z.number().optional(),
  mass_grams: z.number().optional(),
  // Optional component matching for rows that carry a part number instead of id.
  manufacturer_part_number: z.string().optional().nullable(),
})

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1),
})

// Auth: bulk import a flat list of items from a mapped CSV payload
router.post(
  '/versions/:versionId/import',
  authMiddleware,
  zValidator('json', importSchema),
  async (c) => {
    const userId = getUserId(c)
    const versionId = c.req.param('versionId')
    const ctx = await getVersionWithProduct(versionId)
    if (!ctx) return c.json({ error: 'Version not found' }, 404)
    if (ctx.product.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const { rows } = c.req.valid('json')

    // Pre-load workspace components so we can resolve part numbers -> ids.
    const wsComponents = await db
      .select()
      .from(components)
      .where(eq(components.workspace_id, ctx.product.workspace_id))
    const byPartNumber = new Map(
      wsComponents
        .filter((cm) => cm.manufacturer_part_number)
        .map((cm) => [cm.manufacturer_part_number as string, cm.id]),
    )
    const validIds = new Set(wsComponents.map((cm) => cm.id))

    const created: typeof bom_items.$inferSelect[] = []
    for (const row of rows) {
      let componentId: string | null = null
      if (row.component_id && validIds.has(row.component_id)) {
        componentId = row.component_id
      } else if (row.manufacturer_part_number && byPartNumber.has(row.manufacturer_part_number)) {
        componentId = byPartNumber.get(row.manufacturer_part_number) ?? null
      }

      const [inserted] = await db
        .insert(bom_items)
        .values({
          bom_version_id: versionId,
          component_id: componentId,
          parent_id: null,
          reference: row.reference ?? null,
          quantity: row.quantity ?? 1,
          mass_grams: row.mass_grams ?? 0,
        })
        .returning()
      created.push(inserted)
    }

    return c.json({ created: created.length, items: created }, 201)
  },
)

export default router
