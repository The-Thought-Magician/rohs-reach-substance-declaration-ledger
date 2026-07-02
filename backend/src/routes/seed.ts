import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  suppliers,
  supplier_contacts,
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
  declaration_requests,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId, userCanAccessWorkspace } from '../lib/auth.js'

const router = new Hono()

const SEED_WORKSPACE_NAME = 'Sample Compliance Workspace'

// ---------------------------------------------------------------------------
// GET /status?workspace_id= — whether the sample data is present
// ---------------------------------------------------------------------------
router.get('/status', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) {
    return c.json({ seeded: false, counts: {} })
  }
  if (!(await userCanAccessWorkspace(userId, workspaceId))) return c.json({ error: 'Forbidden' }, 403)
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ seeded: false, counts: {} })

  const ps = await db.select().from(products).where(eq(products.workspace_id, workspaceId))
  const comps = await db.select().from(components).where(eq(components.workspace_id, workspaceId))
  const sups = await db.select().from(suppliers).where(eq(suppliers.workspace_id, workspaceId))
  const decls = await db.select().from(declarations).where(eq(declarations.workspace_id, workspaceId))

  const counts = {
    products: ps.length,
    components: comps.length,
    suppliers: sups.length,
    declarations: decls.length,
  }
  const seeded = ps.length > 0 || comps.length > 0 || sups.length > 0
  return c.json({ seeded, counts })
})

// ---------------------------------------------------------------------------
// POST / — seed sample data for the current user
// Includes a deliberately non-compliant product (lead above RoHS limit + an
// SVHC above the 0.1% article threshold).
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  // --- Workspace + owner membership ------------------------------------
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: SEED_WORKSPACE_NAME,
      company: 'Acme Electronics Ltd',
      market_regions: ['EU', 'UK'],
      default_thresholds: { rohs_ppm: 1000, svhc_ppm: 1000 },
      owner_id: userId,
    })
    .returning()
  const wsId = workspace.id

  await db
    .insert(workspace_members)
    .values({ workspace_id: wsId, user_id: userId, role: 'owner' })

  const counts = {
    workspaces: 1,
    suppliers: 0,
    contacts: 0,
    products: 0,
    bomVersions: 0,
    components: 0,
    bomItems: 0,
    materials: 0,
    materialSubstances: 0,
    restrictedSubstances: 0,
    svhcVersions: 0,
    svhcSubstances: 0,
    exemptions: 0,
    appliedExemptions: 0,
    declarations: 0,
    declarationSubstances: 0,
    declarationRequests: 0,
  }

  // --- Suppliers + contacts --------------------------------------------
  const [supplierA] = await db
    .insert(suppliers)
    .values({
      workspace_id: wsId,
      name: 'Shenzhen Component Co',
      region: 'CN',
      accepted_formats: ['IPC-1752A', 'IEC62474'],
      responsiveness_score: 0.92,
      notes: 'Primary connector supplier. Fast turnaround.',
      owner_id: userId,
    })
    .returning()
  const [supplierB] = await db
    .insert(suppliers)
    .values({
      workspace_id: wsId,
      name: 'Legacy Plating Inc',
      region: 'US',
      accepted_formats: ['PDF'],
      responsiveness_score: 0.31,
      notes: 'Slow to respond. Escalation often needed.',
      owner_id: userId,
    })
    .returning()
  counts.suppliers = 2

  await db.insert(supplier_contacts).values([
    {
      supplier_id: supplierA.id,
      name: 'Wei Chen',
      email: 'wei.chen@shenzhencomp.example',
      role: 'Compliance Manager',
      is_escalation: false,
    },
    {
      supplier_id: supplierB.id,
      name: 'John Doe',
      email: 'john.doe@legacyplating.example',
      role: 'Quality Lead',
      is_escalation: true,
    },
  ])
  counts.contacts = 2

  // --- Restricted substances (RoHS) ------------------------------------
  const [rsLead] = await db
    .insert(restricted_substances)
    .values({
      name: 'Lead',
      cas_number: '7439-92-1',
      ec_number: '231-100-4',
      max_concentration_ppm: 1000,
      threshold_basis: 'homogeneous_material',
      restriction_basis: 'RoHS Annex II',
      list_version: 'RoHS3',
    })
    .returning()
  await db.insert(restricted_substances).values([
    {
      name: 'Cadmium',
      cas_number: '7440-43-9',
      ec_number: '231-152-8',
      max_concentration_ppm: 100,
      threshold_basis: 'homogeneous_material',
      restriction_basis: 'RoHS Annex II',
      list_version: 'RoHS3',
    },
    {
      name: 'Mercury',
      cas_number: '7439-97-6',
      ec_number: '231-106-7',
      max_concentration_ppm: 1000,
      threshold_basis: 'homogeneous_material',
      restriction_basis: 'RoHS Annex II',
      list_version: 'RoHS3',
    },
    {
      name: 'Hexavalent Chromium',
      cas_number: '18540-29-9',
      max_concentration_ppm: 1000,
      threshold_basis: 'homogeneous_material',
      restriction_basis: 'RoHS Annex II',
      list_version: 'RoHS3',
    },
  ])
  counts.restrictedSubstances = 4

  // --- SVHC list version + substances ------------------------------------
  // svhc_list_versions.version_label is a globally-unique regulatory list
  // (not per-workspace), so re-seeding must reuse an existing row rather
  // than always inserting a fresh one.
  const svhcLabel = `ECHA Candidate List ${new Date().getFullYear()}`
  const [existingSvhcVersion] = await db
    .select()
    .from(svhc_list_versions)
    .where(eq(svhc_list_versions.version_label, svhcLabel))
  const [svhcVersion] =
    existingSvhcVersion !== undefined
      ? [existingSvhcVersion]
      : await db
          .insert(svhc_list_versions)
          .values({
            version_label: svhcLabel,
            published_at: new Date(),
            substance_count: 2,
          })
          .returning()
  counts.svhcVersions = 1

  const existingSvhcSubstances = await db
    .select()
    .from(svhc_substances)
    .where(eq(svhc_substances.list_version_id, svhcVersion.id))
  let svhcDehp = existingSvhcSubstances.find((s) => s.cas_number === '117-81-7')
  if (existingSvhcSubstances.length === 0) {
    ;[svhcDehp] = await db
      .insert(svhc_substances)
      .values({
        list_version_id: svhcVersion.id,
        name: 'Bis(2-ethylhexyl) phthalate (DEHP)',
        cas_number: '117-81-7',
        ec_number: '204-211-0',
        date_of_inclusion: new Date('2008-10-28'),
        reason_for_inclusion: 'Toxic for reproduction',
        article_threshold_ppm: 1000,
      })
      .returning()
    await db.insert(svhc_substances).values({
      list_version_id: svhcVersion.id,
      name: 'Lead (SVHC entry)',
      cas_number: '7439-92-1',
      ec_number: '231-100-4',
      date_of_inclusion: new Date('2018-06-27'),
      reason_for_inclusion: 'Toxic for reproduction',
      article_threshold_ppm: 1000,
    })
  }
  counts.svhcSubstances = 2

  // --- Exemptions ------------------------------------------------------
  const [exemption6c] = await db
    .insert(exemptions)
    .values({
      exemption_number: '6(c)',
      description: 'Copper alloy containing up to 4% lead by weight',
      scope: 'EEE',
      substance_name: 'Lead',
      expiry_date: new Date(Date.now() + 60 * 86_400_000), // expiring within 90 days
    })
    .returning()
  await db.insert(exemptions).values({
    exemption_number: '7(a)',
    description: 'Lead in high melting temperature type solders',
    scope: 'EEE',
    substance_name: 'Lead',
    expiry_date: new Date(Date.now() + 540 * 86_400_000),
  })
  counts.exemptions = 2

  // --- Components + materials + substances -----------------------------
  // Compliant component (connector) supplied by supplierA.
  const [compConnector] = await db
    .insert(components)
    .values({
      workspace_id: wsId,
      name: 'USB-C Receptacle',
      manufacturer_part_number: 'USBC-RA-001',
      description: 'Surface-mount USB-C connector',
      supplier_id: supplierA.id,
      manufacturer: 'Shenzhen Component Co',
      mass_grams: 1.2,
      owner_id: userId,
    })
    .returning()
  // Non-compliant component (plated bracket) supplied by supplierB.
  const [compBracket] = await db
    .insert(components)
    .values({
      workspace_id: wsId,
      name: 'Plated Steel Bracket',
      manufacturer_part_number: 'BRK-PB-220',
      description: 'Leaded brass plated mounting bracket',
      supplier_id: supplierB.id,
      manufacturer: 'Legacy Plating Inc',
      mass_grams: 8.5,
      owner_id: userId,
    })
    .returning()
  // A clean, supporting component.
  const [compPcb] = await db
    .insert(components)
    .values({
      workspace_id: wsId,
      name: 'Main PCB',
      manufacturer_part_number: 'PCB-MN-100',
      description: 'FR-4 4-layer main board',
      supplier_id: supplierA.id,
      manufacturer: 'Shenzhen Component Co',
      mass_grams: 12.0,
      owner_id: userId,
    })
    .returning()
  counts.components = 3

  // Materials for the connector (compliant).
  const [matConnHousing] = await db
    .insert(materials)
    .values({ component_id: compConnector.id, name: 'Housing Plastic', mass_grams: 0.6, is_homogeneous: true })
    .returning()
  const [matConnContact] = await db
    .insert(materials)
    .values({ component_id: compConnector.id, name: 'Contact Plating', mass_grams: 0.6, is_homogeneous: true })
    .returning()
  // Materials for the bracket (non-compliant: leaded brass).
  const [matBracketBrass] = await db
    .insert(materials)
    .values({ component_id: compBracket.id, name: 'Leaded Brass', mass_grams: 6.0, is_homogeneous: true })
    .returning()
  // Material for PCB.
  const [matPcbFr4] = await db
    .insert(materials)
    .values({ component_id: compPcb.id, name: 'FR-4 Laminate', mass_grams: 10.0, is_homogeneous: true })
    .returning()
  counts.materials = 4

  await db.insert(material_substances).values([
    // Connector: compliant levels.
    { material_id: matConnHousing.id, substance_name: 'Polybutylene Terephthalate', cas_number: '26062-94-2', concentration_ppm: 980000 },
    { material_id: matConnContact.id, substance_name: 'Gold', cas_number: '7440-57-5', concentration_ppm: 500 },
    { material_id: matConnContact.id, substance_name: 'Lead', cas_number: '7439-92-1', concentration_ppm: 400 }, // under 1000 ppm RoHS limit
    // Bracket: DELIBERATELY NON-COMPLIANT — lead at 38000 ppm (3.8%), far above the 1000 ppm RoHS limit,
    // and above the SVHC 0.1% article threshold.
    { material_id: matBracketBrass.id, substance_name: 'Copper', cas_number: '7440-50-8', concentration_ppm: 615000 },
    { material_id: matBracketBrass.id, substance_name: 'Zinc', cas_number: '7440-66-6', concentration_ppm: 345000 },
    { material_id: matBracketBrass.id, substance_name: 'Lead', cas_number: '7439-92-1', concentration_ppm: 38000 },
    // PCB: compliant, but contains a trace SVHC (DEHP) under threshold.
    { material_id: matPcbFr4.id, substance_name: 'Epoxy Resin', cas_number: '25068-38-6', concentration_ppm: 600000 },
    { material_id: matPcbFr4.id, substance_name: 'Bis(2-ethylhexyl) phthalate (DEHP)', cas_number: '117-81-7', concentration_ppm: 300 }, // under threshold
  ])
  counts.materialSubstances = 8

  // Apply an exemption to the bracket's lead (justification scenario).
  await db.insert(applied_exemptions).values({
    workspace_id: wsId,
    exemption_id: exemption6c.id,
    component_id: compBracket.id,
    material_id: matBracketBrass.id,
    justification: 'Copper alloy with lead content under 4% — covered by exemption 6(c).',
    owner_id: userId,
  })
  counts.appliedExemptions = 1

  // --- Products + BOMs -------------------------------------------------
  // Compliant product.
  const [productGood] = await db
    .insert(products)
    .values({
      workspace_id: wsId,
      name: 'SmartHub Pro',
      sku: 'SHP-2024',
      part_number: 'PN-1001',
      category: 'Networking',
      market_region: 'EU',
      lifecycle_status: 'active',
      compliance_status: 'compliant',
      owner_id: userId,
    })
    .returning()
  // Deliberately non-compliant product (uses the leaded bracket).
  const [productBad] = await db
    .insert(products)
    .values({
      workspace_id: wsId,
      name: 'LegacyMount Adapter',
      sku: 'LMA-2019',
      part_number: 'PN-2002',
      category: 'Accessories',
      market_region: 'EU',
      lifecycle_status: 'active',
      compliance_status: 'non_compliant',
      owner_id: userId,
    })
    .returning()
  counts.products = 2

  const [bomGood] = await db
    .insert(bom_versions)
    .values({ product_id: productGood.id, revision: 'A', is_active: true, notes: 'Initial release BOM' })
    .returning()
  const [bomBad] = await db
    .insert(bom_versions)
    .values({ product_id: productBad.id, revision: 'A', is_active: true, notes: 'Initial release BOM' })
    .returning()
  counts.bomVersions = 2

  await db.insert(bom_items).values([
    { bom_version_id: bomGood.id, component_id: compPcb.id, reference: 'PCB1', quantity: 1, mass_grams: 12.0 },
    { bom_version_id: bomGood.id, component_id: compConnector.id, reference: 'J1', quantity: 2, mass_grams: 1.2 },
    { bom_version_id: bomBad.id, component_id: compBracket.id, reference: 'BRK1', quantity: 1, mass_grams: 8.5 },
    { bom_version_id: bomBad.id, component_id: compConnector.id, reference: 'J1', quantity: 1, mass_grams: 1.2 },
  ])
  counts.bomItems = 4

  // --- Declarations ----------------------------------------------------
  const [declConnector] = await db
    .insert(declarations)
    .values({
      workspace_id: wsId,
      supplier_id: supplierA.id,
      component_id: compConnector.id,
      format: 'IPC-1752A',
      status: 'valid',
      document_url: 'https://declarations.example/usbc-ra-001.pdf',
      valid_from: new Date(Date.now() - 90 * 86_400_000),
      valid_until: new Date(Date.now() + 275 * 86_400_000),
      confidence: 'high',
      owner_id: userId,
    })
    .returning()
  // Stale declaration for the bracket.
  const [declBracket] = await db
    .insert(declarations)
    .values({
      workspace_id: wsId,
      supplier_id: supplierB.id,
      component_id: compBracket.id,
      format: 'PDF',
      status: 'expired',
      document_url: 'https://declarations.example/brk-pb-220-old.pdf',
      valid_from: new Date(Date.now() - 800 * 86_400_000),
      valid_until: new Date(Date.now() - 70 * 86_400_000),
      confidence: 'low',
      owner_id: userId,
    })
    .returning()
  counts.declarations = 2

  await db.insert(declaration_substances).values([
    { declaration_id: declConnector.id, material_name: 'Contact Plating', substance_name: 'Lead', cas_number: '7439-92-1', concentration_ppm: 400 },
    { declaration_id: declConnector.id, material_name: 'Contact Plating', substance_name: 'Gold', cas_number: '7440-57-5', concentration_ppm: 500 },
    { declaration_id: declBracket.id, material_name: 'Leaded Brass', substance_name: 'Lead', cas_number: '7439-92-1', concentration_ppm: 38000 },
  ])
  counts.declarationSubstances = 3

  // --- Declaration requests (collection workflow) ----------------------
  await db.insert(declaration_requests).values([
    {
      workspace_id: wsId,
      supplier_id: supplierB.id,
      component_id: compBracket.id,
      product_id: productBad.id,
      status: 'requested',
      reminder_count: 1,
      due_date: new Date(Date.now() + 14 * 86_400_000),
      last_reminded_at: new Date(Date.now() - 3 * 86_400_000),
      owner_id: userId,
    },
    {
      workspace_id: wsId,
      supplier_id: supplierA.id,
      component_id: compPcb.id,
      product_id: productGood.id,
      status: 'received',
      reminder_count: 0,
      due_date: new Date(Date.now() + 30 * 86_400_000),
      owner_id: userId,
    },
  ])
  counts.declarationRequests = 2

  return c.json({ workspace_id: wsId, seeded: counts }, 201)
})

export default router
