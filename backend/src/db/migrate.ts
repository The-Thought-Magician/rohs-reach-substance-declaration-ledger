import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Idempotent self-provisioning DDL. Column names/types match schema.ts exactly.
// Timestamps use timestamptz, floats use real, JSON uses jsonb.
const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    company text,
    market_regions jsonb DEFAULT '[]'::jsonb,
    default_thresholds jsonb DEFAULT '{}'::jsonb,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS suppliers (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    region text,
    accepted_formats jsonb DEFAULT '[]'::jsonb,
    responsiveness_score real DEFAULT 0,
    notes text,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS supplier_contacts (
    id text PRIMARY KEY,
    supplier_id text NOT NULL REFERENCES suppliers(id),
    name text NOT NULL,
    email text,
    role text,
    is_escalation boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    sku text,
    part_number text,
    category text,
    market_region text DEFAULT 'EU',
    lifecycle_status text DEFAULT 'active',
    compliance_status text DEFAULT 'incomplete',
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS bom_versions (
    id text PRIMARY KEY,
    product_id text NOT NULL REFERENCES products(id),
    revision text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS components (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    manufacturer_part_number text,
    description text,
    supplier_id text REFERENCES suppliers(id),
    manufacturer text,
    mass_grams real DEFAULT 0,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS bom_items (
    id text PRIMARY KEY,
    bom_version_id text NOT NULL REFERENCES bom_versions(id),
    component_id text REFERENCES components(id),
    parent_id text,
    reference text,
    quantity real NOT NULL DEFAULT 1,
    mass_grams real DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS materials (
    id text PRIMARY KEY,
    component_id text NOT NULL REFERENCES components(id),
    name text NOT NULL,
    mass_grams real DEFAULT 0,
    is_homogeneous boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS material_substances (
    id text PRIMARY KEY,
    material_id text NOT NULL REFERENCES materials(id),
    substance_name text NOT NULL,
    cas_number text,
    concentration_ppm real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS restricted_substances (
    id text PRIMARY KEY,
    name text NOT NULL,
    cas_number text,
    ec_number text,
    max_concentration_ppm real NOT NULL,
    threshold_basis text DEFAULT 'homogeneous_material',
    restriction_basis text,
    list_version text DEFAULT 'RoHS3',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS svhc_list_versions (
    id text PRIMARY KEY,
    version_label text NOT NULL UNIQUE,
    published_at timestamptz,
    substance_count integer DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS svhc_substances (
    id text PRIMARY KEY,
    list_version_id text REFERENCES svhc_list_versions(id),
    name text NOT NULL,
    cas_number text,
    ec_number text,
    date_of_inclusion timestamptz,
    reason_for_inclusion text,
    article_threshold_ppm real NOT NULL DEFAULT 1000,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS exemptions (
    id text PRIMARY KEY,
    exemption_number text NOT NULL,
    description text NOT NULL,
    scope text,
    substance_name text,
    expiry_date timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS applied_exemptions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    exemption_id text NOT NULL REFERENCES exemptions(id),
    component_id text REFERENCES components(id),
    material_id text REFERENCES materials(id),
    justification text,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS declarations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text REFERENCES suppliers(id),
    component_id text REFERENCES components(id),
    format text DEFAULT 'IPC-1752A',
    status text NOT NULL DEFAULT 'received',
    document_url text,
    valid_from timestamptz,
    valid_until timestamptz,
    confidence text DEFAULT 'medium',
    superseded_by text,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS declaration_substances (
    id text PRIMARY KEY,
    declaration_id text NOT NULL REFERENCES declarations(id),
    material_name text,
    substance_name text NOT NULL,
    cas_number text,
    concentration_ppm real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS declaration_requests (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    supplier_id text REFERENCES suppliers(id),
    component_id text REFERENCES components(id),
    product_id text REFERENCES products(id),
    status text NOT NULL DEFAULT 'requested',
    reminder_count integer NOT NULL DEFAULT 0,
    due_date timestamptz,
    last_reminded_at timestamptz,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS compliance_results (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    product_id text NOT NULL REFERENCES products(id),
    rohs_verdict text DEFAULT 'unknown',
    reach_verdict text DEFAULT 'unknown',
    overall_verdict text DEFAULT 'unknown',
    offending_component_id text,
    offending_substance text,
    coverage_pct real DEFAULT 0,
    details jsonb DEFAULT '[]'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text REFERENCES workspaces(id),
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id text PRIMARY KEY,
    workspace_id text REFERENCES workspaces(id),
    user_id text NOT NULL,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    product_id text REFERENCES products(id),
    component_id text REFERENCES components(id),
    title text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'open',
    assignee_id text,
    due_date timestamptz,
    offending_substance text,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    type text NOT NULL,
    title text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    owner_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_suppliers_workspace ON suppliers(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bom_versions_product ON bom_versions(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_components_workspace ON components(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_components_supplier ON components(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bom_items_bom_version ON bom_items(bom_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bom_items_component ON bom_items(component_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bom_items_parent ON bom_items(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_materials_component ON materials(component_id)`,
  `CREATE INDEX IF NOT EXISTS idx_material_substances_material ON material_substances(material_id)`,
  `CREATE INDEX IF NOT EXISTS idx_material_substances_cas ON material_substances(cas_number)`,
  `CREATE INDEX IF NOT EXISTS idx_svhc_substances_version ON svhc_substances(list_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_applied_exemptions_workspace ON applied_exemptions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_applied_exemptions_component ON applied_exemptions(component_id)`,
  `CREATE INDEX IF NOT EXISTS idx_declarations_workspace ON declarations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_declarations_component ON declarations(component_id)`,
  `CREATE INDEX IF NOT EXISTS idx_declarations_supplier ON declarations(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_declaration_substances_declaration ON declaration_substances(declaration_id)`,
  `CREATE INDEX IF NOT EXISTS idx_declaration_requests_workspace ON declaration_requests(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_declaration_requests_supplier ON declaration_requests(supplier_id)`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_results_workspace ON compliance_results(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_results_product ON compliance_results(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON audit_events(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_product ON tasks(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_workspace ON reports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete: tables and indexes provisioned')
}
