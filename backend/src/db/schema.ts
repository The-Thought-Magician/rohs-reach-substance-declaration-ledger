import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Workspaces & membership
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  company: text('company'),
  market_regions: jsonb('market_regions').$type<string[]>().default([]),
  default_thresholds: jsonb('default_thresholds').$type<Record<string, number>>().default({}),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  region: text('region'),
  accepted_formats: jsonb('accepted_formats').$type<string[]>().default([]),
  responsiveness_score: real('responsiveness_score').default(0),
  notes: text('notes'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const supplier_contacts = pgTable('supplier_contacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  supplier_id: text('supplier_id').notNull().references(() => suppliers.id),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role'),
  is_escalation: boolean('is_escalation').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Products & BOM
// ---------------------------------------------------------------------------

export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  sku: text('sku'),
  part_number: text('part_number'),
  category: text('category'),
  market_region: text('market_region').default('EU'),
  lifecycle_status: text('lifecycle_status').default('active'),
  compliance_status: text('compliance_status').default('incomplete'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const bom_versions = pgTable('bom_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  product_id: text('product_id').notNull().references(() => products.id),
  revision: text('revision').notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const components = pgTable('components', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  manufacturer_part_number: text('manufacturer_part_number'),
  description: text('description'),
  supplier_id: text('supplier_id').references(() => suppliers.id),
  manufacturer: text('manufacturer'),
  mass_grams: real('mass_grams').default(0),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const bom_items = pgTable('bom_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  bom_version_id: text('bom_version_id').notNull().references(() => bom_versions.id),
  component_id: text('component_id').references(() => components.id),
  parent_id: text('parent_id'),
  reference: text('reference'),
  quantity: real('quantity').default(1).notNull(),
  mass_grams: real('mass_grams').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const materials = pgTable('materials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  component_id: text('component_id').notNull().references(() => components.id),
  name: text('name').notNull(),
  mass_grams: real('mass_grams').default(0),
  is_homogeneous: boolean('is_homogeneous').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const material_substances = pgTable('material_substances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  material_id: text('material_id').notNull().references(() => materials.id),
  substance_name: text('substance_name').notNull(),
  cas_number: text('cas_number'),
  concentration_ppm: real('concentration_ppm').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Restricted substances (RoHS) & SVHC (REACH)
// ---------------------------------------------------------------------------

export const restricted_substances = pgTable('restricted_substances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  cas_number: text('cas_number'),
  ec_number: text('ec_number'),
  max_concentration_ppm: real('max_concentration_ppm').notNull(),
  threshold_basis: text('threshold_basis').default('homogeneous_material'),
  restriction_basis: text('restriction_basis'),
  list_version: text('list_version').default('RoHS3'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const svhc_list_versions = pgTable('svhc_list_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  version_label: text('version_label').notNull().unique(),
  published_at: timestamp('published_at'),
  substance_count: integer('substance_count').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const svhc_substances = pgTable('svhc_substances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  list_version_id: text('list_version_id').references(() => svhc_list_versions.id),
  name: text('name').notNull(),
  cas_number: text('cas_number'),
  ec_number: text('ec_number'),
  date_of_inclusion: timestamp('date_of_inclusion'),
  reason_for_inclusion: text('reason_for_inclusion'),
  article_threshold_ppm: real('article_threshold_ppm').default(1000).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

export const exemptions = pgTable('exemptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  exemption_number: text('exemption_number').notNull(),
  description: text('description').notNull(),
  scope: text('scope'),
  substance_name: text('substance_name'),
  expiry_date: timestamp('expiry_date'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const applied_exemptions = pgTable('applied_exemptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  exemption_id: text('exemption_id').notNull().references(() => exemptions.id),
  component_id: text('component_id').references(() => components.id),
  material_id: text('material_id').references(() => materials.id),
  justification: text('justification'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Declarations & collection workflow
// ---------------------------------------------------------------------------

export const declarations = pgTable('declarations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').references(() => suppliers.id),
  component_id: text('component_id').references(() => components.id),
  format: text('format').default('IPC-1752A'),
  status: text('status').notNull().default('received'),
  document_url: text('document_url'),
  valid_from: timestamp('valid_from'),
  valid_until: timestamp('valid_until'),
  confidence: text('confidence').default('medium'),
  superseded_by: text('superseded_by'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const declaration_substances = pgTable('declaration_substances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  declaration_id: text('declaration_id').notNull().references(() => declarations.id),
  material_name: text('material_name'),
  substance_name: text('substance_name').notNull(),
  cas_number: text('cas_number'),
  concentration_ppm: real('concentration_ppm').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const declaration_requests = pgTable('declaration_requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  supplier_id: text('supplier_id').references(() => suppliers.id),
  component_id: text('component_id').references(() => components.id),
  product_id: text('product_id').references(() => products.id),
  status: text('status').notNull().default('requested'),
  reminder_count: integer('reminder_count').default(0).notNull(),
  due_date: timestamp('due_date'),
  last_reminded_at: timestamp('last_reminded_at'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Compliance results (threshold engine output)
// ---------------------------------------------------------------------------

export const compliance_results = pgTable('compliance_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  product_id: text('product_id').notNull().references(() => products.id),
  rohs_verdict: text('rohs_verdict').default('unknown'),
  reach_verdict: text('reach_verdict').default('unknown'),
  overall_verdict: text('overall_verdict').default('unknown'),
  offending_component_id: text('offending_component_id'),
  offending_substance: text('offending_substance'),
  coverage_pct: real('coverage_pct').default(0),
  details: jsonb('details').$type<Array<Record<string, unknown>>>().default([]),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Notifications, audit, tasks, reports
// ---------------------------------------------------------------------------

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const audit_events = pgTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  product_id: text('product_id').references(() => products.id),
  component_id: text('component_id').references(() => components.id),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('open'),
  assignee_id: text('assignee_id'),
  due_date: timestamp('due_date'),
  offending_substance: text('offending_substance'),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  owner_id: text('owner_id').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
