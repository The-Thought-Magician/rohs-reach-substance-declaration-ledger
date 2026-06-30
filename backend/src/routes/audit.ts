import { Hono } from 'hono'
import { db } from '../db/index.js'
import { audit_events, compliance_results } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'

const router = new Hono()

// Public: paginated audit/evidence log
// (?workspace_id, ?entity_type, ?entity_id, ?limit, ?offset)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')

  const rawLimit = parseInt(c.req.query('limit') ?? '100', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10)
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0

  const conds = []
  if (workspaceId) conds.push(eq(audit_events.workspace_id, workspaceId))
  if (entityType) conds.push(eq(audit_events.entity_type, entityType))
  if (entityId) conds.push(eq(audit_events.entity_id, entityId))

  const base = db.select().from(audit_events)
  const rows = conds.length
    ? await base
        .where(and(...conds))
        .orderBy(desc(audit_events.created_at))
        .limit(limit)
        .offset(offset)
    : await base.orderBy(desc(audit_events.created_at)).limit(limit).offset(offset)

  return c.json(rows)
})

// Public: evidence trail for a product.
// Pulls audit rows directly anchored to the product, plus rows for that product's
// compliance results (offending parts/substances), forming an immutable trail.
router.get('/product/:productId', async (c) => {
  const productId = c.req.param('productId')

  // Compliance result ids for this product (evidence entities).
  const results = await db
    .select({ id: compliance_results.id })
    .from(compliance_results)
    .where(eq(compliance_results.product_id, productId))
  const resultIds = results.map((r) => r.id)

  // Audit rows that reference the product directly.
  const productRows = await db
    .select()
    .from(audit_events)
    .where(
      and(eq(audit_events.entity_type, 'product'), eq(audit_events.entity_id, productId)),
    )
    .orderBy(desc(audit_events.created_at))

  // Audit rows referencing compliance results of this product.
  const resultRows = resultIds.length
    ? await db
        .select()
        .from(audit_events)
        .where(
          and(
            eq(audit_events.entity_type, 'compliance_result'),
            inArray(audit_events.entity_id, resultIds),
          ),
        )
        .orderBy(desc(audit_events.created_at))
    : []

  const merged = [...productRows, ...resultRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return c.json(merged)
})

export default router
