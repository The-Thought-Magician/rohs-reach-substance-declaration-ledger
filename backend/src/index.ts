import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  suppliers,
  products,
  bom_versions,
  components,
  bom_items,
  materials,
  material_substances,
  restricted_substances,
  svhc_list_versions,
  svhc_substances,
  exemptions,
  applied_exemptions,
  declarations,
  declaration_substances,
} from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import suppliersRoutes from './routes/suppliers.js'
import productsRoutes from './routes/products.js'
import bomsRoutes from './routes/boms.js'
import componentsRoutes from './routes/components.js'
import materialsRoutes from './routes/materials.js'
import restrictedSubstancesRoutes from './routes/restricted-substances.js'
import svhcRoutes from './routes/svhc.js'
import exemptionsRoutes from './routes/exemptions.js'
import declarationsRoutes from './routes/declarations.js'
import declarationRequestsRoutes from './routes/declaration-requests.js'
import complianceRoutes from './routes/compliance.js'
import scipRoutes from './routes/scip.js'
import packsRoutes from './routes/packs.js'
import notificationsRoutes from './routes/notifications.js'
import tasksRoutes from './routes/tasks.js'
import auditRoutes from './routes/audit.js'
import searchRoutes from './routes/search.js'
import dashboardRoutes from './routes/dashboard.js'
import reportsRoutes from './routes/reports.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://rohs-reach-substance-declaration-ledger.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/suppliers', suppliersRoutes)
api.route('/products', productsRoutes)
api.route('/boms', bomsRoutes)
api.route('/components', componentsRoutes)
api.route('/materials', materialsRoutes)
api.route('/restricted-substances', restrictedSubstancesRoutes)
api.route('/svhc', svhcRoutes)
api.route('/exemptions', exemptionsRoutes)
api.route('/declarations', declarationsRoutes)
api.route('/declaration-requests', declarationRequestsRoutes)
api.route('/compliance', complianceRoutes)
api.route('/scip', scipRoutes)
api.route('/packs', packsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/tasks', tasksRoutes)
api.route('/audit', auditRoutes)
api.route('/search', searchRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/reports', reportsRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Idempotent seed: plans + a minimal demo workspace with a deliberately
// non-compliant product so the dashboard has something to render on first run.
// Count-then-insert so it is safe to call on every boot.
// ---------------------------------------------------------------------------

const DEMO_OWNER = 'demo-user'

async function seedIfEmpty(): Promise<void> {
  // Plans (always ensure free + pro exist).
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db
      .insert(plans)
      .values([
        { id: 'free', name: 'Free', price_cents: 0 },
        { id: 'pro', name: 'Pro', price_cents: 4900 },
      ])
      .onConflictDoNothing()
    console.log('Seeded plans')
  }

  // Demo domain data.
  const existingWorkspaces = await db.select().from(workspaces).limit(1)
  if (existingWorkspaces.length > 0) return

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: 'Demo Workspace',
      company: 'Acme Electronics',
      market_regions: ['EU', 'UK'],
      default_thresholds: { rohs_ppm: 1000, svhc_ppm: 1000 },
      owner_id: DEMO_OWNER,
    })
    .returning()

  await db
    .insert(workspace_members)
    .values({ workspace_id: ws.id, user_id: DEMO_OWNER, role: 'owner' })
    .onConflictDoNothing()

  // Supplier.
  const [supplier] = await db
    .insert(suppliers)
    .values({
      workspace_id: ws.id,
      name: 'Shenzhen Components Co.',
      region: 'CN',
      accepted_formats: ['IPC-1752A', 'PDF'],
      responsiveness_score: 0.72,
      notes: 'Primary passive-component supplier.',
      owner_id: DEMO_OWNER,
    })
    .returning()

  // Restricted substances (RoHS).
  await db
    .insert(restricted_substances)
    .values([
      { name: 'Lead', cas_number: '7439-92-1', max_concentration_ppm: 1000, restriction_basis: 'RoHS Annex II' },
      { name: 'Cadmium', cas_number: '7440-43-9', max_concentration_ppm: 100, restriction_basis: 'RoHS Annex II' },
      { name: 'Mercury', cas_number: '7439-97-6', max_concentration_ppm: 1000, restriction_basis: 'RoHS Annex II' },
      { name: 'Hexavalent Chromium', cas_number: '18540-29-9', max_concentration_ppm: 1000, restriction_basis: 'RoHS Annex II' },
      { name: 'DEHP', cas_number: '117-81-7', max_concentration_ppm: 1000, restriction_basis: 'RoHS Annex II (phthalate)' },
    ])
    .onConflictDoNothing()

  // SVHC list version + substances.
  const [svhcVersion] = await db
    .insert(svhc_list_versions)
    .values({ version_label: 'ECHA 2024-06', published_at: new Date('2024-06-27'), substance_count: 2 })
    .returning()

  await db
    .insert(svhc_substances)
    .values([
      {
        list_version_id: svhcVersion.id,
        name: 'Lead',
        cas_number: '7439-92-1',
        date_of_inclusion: new Date('2018-06-27'),
        reason_for_inclusion: 'Toxic for reproduction',
        article_threshold_ppm: 1000,
      },
      {
        list_version_id: svhcVersion.id,
        name: 'DEHP',
        cas_number: '117-81-7',
        date_of_inclusion: new Date('2008-10-28'),
        reason_for_inclusion: 'Toxic for reproduction',
        article_threshold_ppm: 1000,
      },
    ])
    .onConflictDoNothing()

  // Exemption.
  await db
    .insert(exemptions)
    .values({
      exemption_number: '6(c)',
      description: 'Copper alloy containing up to 4% lead by weight',
      scope: 'Copper alloys',
      substance_name: 'Lead',
      expiry_date: new Date('2026-07-21'),
    })
    .onConflictDoNothing()

  // Compliant product.
  const [compliantProduct] = await db
    .insert(products)
    .values({
      workspace_id: ws.id,
      name: 'Sensor Module A1',
      sku: 'SM-A1',
      part_number: 'PN-1001',
      category: 'Electronics',
      market_region: 'EU',
      compliance_status: 'compliant',
      owner_id: DEMO_OWNER,
    })
    .returning()

  // Non-compliant product (deliberate, for demo).
  const [badProduct] = await db
    .insert(products)
    .values({
      workspace_id: ws.id,
      name: 'Legacy Connector X',
      sku: 'LC-X',
      part_number: 'PN-2002',
      category: 'Connectors',
      market_region: 'EU',
      compliance_status: 'non_compliant',
      owner_id: DEMO_OWNER,
    })
    .returning()

  // BOM versions.
  const [bomA] = await db
    .insert(bom_versions)
    .values({ product_id: compliantProduct.id, revision: 'A', is_active: true, notes: 'Initial release' })
    .returning()
  const [bomX] = await db
    .insert(bom_versions)
    .values({ product_id: badProduct.id, revision: 'A', is_active: true, notes: 'Legacy design' })
    .returning()

  // Components.
  const [resistor] = await db
    .insert(components)
    .values({
      workspace_id: ws.id,
      name: 'Resistor 10k',
      manufacturer_part_number: 'RC0805-10K',
      description: '0805 thick-film resistor',
      supplier_id: supplier.id,
      manufacturer: 'Yageo',
      mass_grams: 0.01,
      owner_id: DEMO_OWNER,
    })
    .returning()
  const [leadedConnector] = await db
    .insert(components)
    .values({
      workspace_id: ws.id,
      name: 'Leaded Connector',
      manufacturer_part_number: 'CONN-PB-12',
      description: 'Legacy connector with leaded solder',
      supplier_id: supplier.id,
      manufacturer: 'Generic',
      mass_grams: 2.5,
      owner_id: DEMO_OWNER,
    })
    .returning()

  // BOM items.
  await db.insert(bom_items).values([
    { bom_version_id: bomA.id, component_id: resistor.id, reference: 'R1', quantity: 4, mass_grams: 0.04 },
    { bom_version_id: bomX.id, component_id: leadedConnector.id, reference: 'J1', quantity: 1, mass_grams: 2.5 },
  ])

  // Materials.
  const [ceramic] = await db
    .insert(materials)
    .values({ component_id: resistor.id, name: 'Ceramic body', mass_grams: 0.008, is_homogeneous: true })
    .returning()
  const [solder] = await db
    .insert(materials)
    .values({ component_id: leadedConnector.id, name: 'Solder joint', mass_grams: 0.3, is_homogeneous: true })
    .returning()

  // Material substances — solder breaches the lead threshold (non-compliant).
  await db.insert(material_substances).values([
    { material_id: ceramic.id, substance_name: 'Aluminium oxide', cas_number: '1344-28-1', concentration_ppm: 900000 },
    { material_id: solder.id, substance_name: 'Lead', cas_number: '7439-92-1', concentration_ppm: 350000 },
  ])

  // A received declaration for the resistor.
  const [decl] = await db
    .insert(declarations)
    .values({
      workspace_id: ws.id,
      supplier_id: supplier.id,
      component_id: resistor.id,
      format: 'IPC-1752A',
      status: 'received',
      confidence: 'high',
      valid_from: new Date('2024-01-01'),
      valid_until: new Date('2027-01-01'),
      owner_id: DEMO_OWNER,
    })
    .returning()

  await db.insert(declaration_substances).values({
    declaration_id: decl.id,
    material_name: 'Ceramic body',
    substance_name: 'Lead',
    cas_number: '7439-92-1',
    concentration_ppm: 0,
  })

  // Touch applied_exemptions table reference (kept empty by default).
  void applied_exemptions

  console.log('Seeded demo workspace data')
}

// ---------------------------------------------------------------------------
// Boot order: bind the port FIRST so the platform health check sees a live
// service immediately, THEN run migrate() and seedIfEmpty() (each idempotent,
// each in its own try/catch). NEVER await DB work before serve().
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? '3001')

serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))
;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
