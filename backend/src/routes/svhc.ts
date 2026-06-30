import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  svhc_list_versions,
  svhc_substances,
  material_substances,
  materials,
  components,
  bom_items,
  bom_versions,
  products,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const versionSchema = z.object({
  version_label: z.string().min(1),
  published_at: z.string().datetime().optional().nullable(),
  substance_count: z.number().int().nonnegative().optional(),
})

const substanceSchema = z.object({
  list_version_id: z.string().optional().nullable(),
  name: z.string().min(1),
  cas_number: z.string().optional().nullable(),
  ec_number: z.string().optional().nullable(),
  date_of_inclusion: z.string().datetime().optional().nullable(),
  reason_for_inclusion: z.string().optional().nullable(),
  article_threshold_ppm: z.number().nonnegative().optional(),
})

// Public: candidate-list versions (newest first)
router.get('/versions', async (c) => {
  const all = await db
    .select()
    .from(svhc_list_versions)
    .orderBy(desc(svhc_list_versions.created_at))
  return c.json(all)
})

// Auth: add a list-version snapshot
router.post('/versions', authMiddleware, zValidator('json', versionSchema), async (c) => {
  getUserId(c)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(svhc_list_versions)
    .values({
      version_label: body.version_label,
      published_at: body.published_at ? new Date(body.published_at) : null,
      substance_count: body.substance_count ?? 0,
    })
    .returning()
  return c.json(row, 201)
})

// Public: SVHC substances (optionally filtered by version_id)
router.get('/substances', async (c) => {
  const versionId = c.req.query('version_id')
  const rows = versionId
    ? await db
        .select()
        .from(svhc_substances)
        .where(eq(svhc_substances.list_version_id, versionId))
        .orderBy(svhc_substances.name)
    : await db.select().from(svhc_substances).orderBy(svhc_substances.name)
  return c.json(rows)
})

// Auth: add SVHC substance
router.post('/substances', authMiddleware, zValidator('json', substanceSchema), async (c) => {
  getUserId(c)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(svhc_substances)
    .values({
      list_version_id: body.list_version_id ?? null,
      name: body.name,
      cas_number: body.cas_number ?? null,
      ec_number: body.ec_number ?? null,
      date_of_inclusion: body.date_of_inclusion ? new Date(body.date_of_inclusion) : null,
      reason_for_inclusion: body.reason_for_inclusion ?? null,
      article_threshold_ppm: body.article_threshold_ppm ?? 1000,
    })
    .returning()
  // Keep the version's substance_count roughly in sync if attached to a version.
  if (body.list_version_id) {
    const counted = await db
      .select()
      .from(svhc_substances)
      .where(eq(svhc_substances.list_version_id, body.list_version_id))
    await db
      .update(svhc_list_versions)
      .set({ substance_count: counted.length })
      .where(eq(svhc_list_versions.id, body.list_version_id))
  }
  return c.json(row, 201)
})

// Auth: delete a substance
router.delete('/substances/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(svhc_substances)
    .where(eq(svhc_substances.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(svhc_substances).where(eq(svhc_substances.id, id))
  if (existing.list_version_id) {
    const counted = await db
      .select()
      .from(svhc_substances)
      .where(eq(svhc_substances.list_version_id, existing.list_version_id))
    await db
      .update(svhc_list_versions)
      .set({ substance_count: counted.length })
      .where(eq(svhc_list_versions.id, existing.list_version_id))
  }
  return c.json({ success: true })
})

// Public: diff — substances added between two versions (?from=&to=)
router.get('/diff', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from and to version ids are required' }, 400)

  const fromRows = await db
    .select()
    .from(svhc_substances)
    .where(eq(svhc_substances.list_version_id, from))
  const toRows = await db
    .select()
    .from(svhc_substances)
    .where(eq(svhc_substances.list_version_id, to))

  // Identify substances present in `to` but not in `from`, keyed by CAS (fallback to name).
  const keyOf = (s: { cas_number: string | null; name: string }) =>
    (s.cas_number && s.cas_number.trim()) || s.name.toLowerCase()
  const fromKeys = new Set(fromRows.map(keyOf))
  const added = toRows.filter((s) => !fromKeys.has(keyOf(s)))
  return c.json({ added })
})

// Public: watch — products newly affected by SVHC substances in the latest version
router.get('/watch', async (c) => {
  const workspaceId = c.req.query('workspace_id')

  // Resolve the latest SVHC version.
  const [latest] = await db
    .select()
    .from(svhc_list_versions)
    .orderBy(desc(svhc_list_versions.created_at))
    .limit(1)
  if (!latest) return c.json({ affected: [] })

  const latestSubstances = await db
    .select()
    .from(svhc_substances)
    .where(eq(svhc_substances.list_version_id, latest.id))

  // Index SVHC entries by CAS and by lowercased name for matching.
  const byCas = new Map<string, (typeof latestSubstances)[number]>()
  const byName = new Map<string, (typeof latestSubstances)[number]>()
  for (const s of latestSubstances) {
    if (s.cas_number && s.cas_number.trim()) byCas.set(s.cas_number.trim(), s)
    byName.set(s.name.toLowerCase(), s)
  }
  if (byCas.size === 0 && byName.size === 0) return c.json({ affected: [] })

  // Walk material substances -> material -> component -> bom_items -> bom_versions -> products.
  const rows = await db
    .select({
      product_id: products.id,
      product_name: products.name,
      product_workspace: products.workspace_id,
      substance_name: material_substances.substance_name,
      substance_cas: material_substances.cas_number,
      concentration_ppm: material_substances.concentration_ppm,
      component_id: components.id,
      component_name: components.name,
    })
    .from(material_substances)
    .innerJoin(materials, eq(materials.id, material_substances.material_id))
    .innerJoin(components, eq(components.id, materials.component_id))
    .innerJoin(bom_items, eq(bom_items.component_id, components.id))
    .innerJoin(bom_versions, eq(bom_versions.id, bom_items.bom_version_id))
    .innerJoin(products, eq(products.id, bom_versions.product_id))

  const affected: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (workspaceId && r.product_workspace !== workspaceId) continue
    const cas = (r.substance_cas ?? '').trim()
    const match =
      (cas && byCas.get(cas)) || byName.get((r.substance_name ?? '').toLowerCase())
    if (!match) continue
    // Only flag where it crosses the article threshold (REACH article basis).
    if ((r.concentration_ppm ?? 0) < (match.article_threshold_ppm ?? 1000)) continue
    const dedupeKey = `${r.product_id}:${match.id}:${r.component_id}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    affected.push({
      product: { id: r.product_id, name: r.product_name },
      component: { id: r.component_id, name: r.component_name },
      substance: {
        id: match.id,
        name: match.name,
        cas_number: match.cas_number,
        article_threshold_ppm: match.article_threshold_ppm,
      },
      concentration_ppm: r.concentration_ppm,
      list_version: latest.version_label,
    })
  }

  return c.json({ affected })
})

export default router
