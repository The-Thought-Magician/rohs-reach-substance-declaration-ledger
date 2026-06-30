# Build Plan — RoHS/REACH Substance Declaration Ledger

This is the single source of truth for the build. Filenames, mount paths, api method names, and page files declared here are binding. Stack: Hono backend (mount under `/api/v1` via child `api` router), Next.js 16 + Neon Auth frontend, Neon Postgres via drizzle-orm. Backend trusts `X-User-Id`; handlers use `getUserId(c)`. Public reads / auth-gated writes with zod + ownership checks. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

---

## (a) Tables (with columns)

1. **workspaces** — id, name, company, market_regions(jsonb), default_thresholds(jsonb), owner_id, created_at, updated_at
2. **workspace_members** — id, workspace_id(fk), user_id, role, created_at; UNIQUE(workspace_id,user_id)
3. **suppliers** — id, workspace_id(fk), name, region, accepted_formats(jsonb), responsiveness_score(real), notes, owner_id, created_at
4. **supplier_contacts** — id, supplier_id(fk), name, email, role, is_escalation(bool), created_at
5. **products** — id, workspace_id(fk), name, sku, part_number, category, market_region, lifecycle_status, compliance_status, owner_id, created_at, updated_at
6. **bom_versions** — id, product_id(fk), revision, is_active(bool), notes, created_at
7. **components** — id, workspace_id(fk), name, manufacturer_part_number, description, supplier_id(fk), manufacturer, mass_grams(real), owner_id, created_at
8. **bom_items** — id, bom_version_id(fk), component_id(fk), parent_id, reference, quantity(real), mass_grams(real), created_at
9. **materials** — id, component_id(fk), name, mass_grams(real), is_homogeneous(bool), created_at
10. **material_substances** — id, material_id(fk), substance_name, cas_number, concentration_ppm(real), created_at
11. **restricted_substances** — id, name, cas_number, ec_number, max_concentration_ppm(real), threshold_basis, restriction_basis, list_version, created_at
12. **svhc_list_versions** — id, version_label(unique), published_at, substance_count(int), created_at
13. **svhc_substances** — id, list_version_id(fk), name, cas_number, ec_number, date_of_inclusion, reason_for_inclusion, article_threshold_ppm(real), created_at
14. **exemptions** — id, exemption_number, description, scope, substance_name, expiry_date, created_at
15. **applied_exemptions** — id, workspace_id(fk), exemption_id(fk), component_id(fk), material_id(fk), justification, owner_id, created_at
16. **declarations** — id, workspace_id(fk), supplier_id(fk), component_id(fk), format, status, document_url, valid_from, valid_until, confidence, superseded_by, owner_id, created_at
17. **declaration_substances** — id, declaration_id(fk), material_name, substance_name, cas_number, concentration_ppm(real), created_at
18. **declaration_requests** — id, workspace_id(fk), supplier_id(fk), component_id(fk), product_id(fk), status, reminder_count(int), due_date, last_reminded_at, owner_id, created_at
19. **compliance_results** — id, workspace_id(fk), product_id(fk), rohs_verdict, reach_verdict, overall_verdict, offending_component_id, offending_substance, coverage_pct(real), details(jsonb), computed_at, created_at
20. **notifications** — id, workspace_id(fk), user_id, type, title, body, link, is_read(bool), created_at
21. **audit_events** — id, workspace_id(fk), user_id, action, entity_type, entity_id, metadata(jsonb), created_at
22. **tasks** — id, workspace_id(fk), product_id(fk), component_id(fk), title, description, status, assignee_id, due_date, offending_substance, owner_id, created_at
23. **reports** — id, workspace_id(fk), type, title, payload(jsonb), owner_id, created_at
24. **plans** — id(text PK 'free'/'pro'), name, price_cents(int), created_at
25. **subscriptions** — id, user_id(unique), plan_id(fk->plans), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

Conventions: every file `export default router`. Reads public, writes auth-gated (`authMiddleware`) with zod validation and ownership checks via `getUserId(c)`. Response shapes are JSON.

### 1. `workspaces.ts` → mount `workspaces`
- `GET /` — public — list current user's workspaces (by membership/owner) — `Workspace[]`
- `GET /:id` — public — workspace detail — `Workspace`
- `POST /` — auth — create workspace (also inserts owner membership) — `Workspace`
- `PUT /:id` — auth(owner) — update workspace settings — `Workspace`
- `GET /:id/members` — public — list members — `WorkspaceMember[]`
- `POST /:id/members` — auth(owner) — add member {user_id, role} — `WorkspaceMember`
- `DELETE /:id/members/:memberId` — auth(owner) — remove member — `{success}`

### 2. `suppliers.ts` → mount `suppliers`
- `GET /` — public — list suppliers (?workspace_id) — `Supplier[]`
- `GET /:id` — public — supplier detail — `Supplier`
- `GET /:id/scorecard` — public — responsiveness, declaration freshness, pass rate — `{supplier, partsSupplied, declarationsOnFile, coveragePct, passRate}`
- `POST /` — auth — create supplier — `Supplier`
- `PUT /:id` — auth(owner) — update — `Supplier`
- `DELETE /:id` — auth(owner) — delete — `{success}`
- `GET /:id/contacts` — public — list contacts — `SupplierContact[]`
- `POST /:id/contacts` — auth — add contact — `SupplierContact`
- `DELETE /:id/contacts/:contactId` — auth — remove contact — `{success}`

### 3. `products.ts` → mount `products`
- `GET /` — public — list products (?workspace_id, ?status) with status badges — `Product[]`
- `GET /:id` — public — product detail + latest compliance_result — `{product, result}`
- `POST /` — auth — create product — `Product`
- `PUT /:id` — auth(owner) — update — `Product`
- `DELETE /:id` — auth(owner) — delete — `{success}`
- `GET /:id/rollup` — public — full roll-up: verdict, offending part/substance, coverage, drill-down tree — `{product, verdict, offending, coveragePct, tree}`

### 4. `boms.ts` → mount `boms`
- `GET /product/:productId/versions` — public — list BOM versions — `BomVersion[]`
- `POST /product/:productId/versions` — auth — create version {revision, notes} — `BomVersion`
- `POST /product/:productId/clone/:versionId` — auth — clone a version to new revision — `BomVersion`
- `GET /versions/:versionId/items` — public — list BOM items (tree) — `BomItem[]`
- `POST /versions/:versionId/items` — auth — add item {component_id, parent_id, reference, quantity, mass_grams} — `BomItem`
- `PUT /items/:itemId` — auth — update/re-parent item — `BomItem`
- `DELETE /items/:itemId` — auth — delete item — `{success}`
- `POST /versions/:versionId/import` — auth — bulk CSV-mapped import {rows:[...]} — `{created:n, items:BomItem[]}`

### 5. `components.ts` → mount `components`
- `GET /` — public — catalog list (?workspace_id, ?substance_cas, ?supplier_id) — `Component[]`
- `GET /:id` — public — component detail + materials — `{component, materials}`
- `POST /` — auth — create component — `Component`
- `PUT /:id` — auth(owner) — update — `Component`
- `DELETE /:id` — auth(owner) — delete — `{success}`

### 6. `materials.ts` → mount `materials`
- `GET /component/:componentId` — public — materials of a component — `Material[]`
- `POST /component/:componentId` — auth — add material — `Material`
- `PUT /:id` — auth — update material — `Material`
- `DELETE /:id` — auth — delete material — `{success}`
- `GET /:id/substances` — public — substance composition — `MaterialSubstance[]`
- `POST /:id/substances` — auth — add substance {substance_name, cas_number, concentration_ppm} — `MaterialSubstance`
- `DELETE /substances/:substanceId` — auth — delete substance row — `{success}`

### 7. `restricted-substances.ts` → mount `restricted-substances`
- `GET /` — public — RoHS restricted-substance catalog — `RestrictedSubstance[]`
- `GET /:id` — public — detail — `RestrictedSubstance`
- `POST /` — auth — add restricted substance — `RestrictedSubstance`
- `PUT /:id` — auth — update threshold/metadata — `RestrictedSubstance`
- `DELETE /:id` — auth — delete — `{success}`

### 8. `svhc.ts` → mount `svhc`
- `GET /versions` — public — candidate-list versions — `SvhcListVersion[]`
- `POST /versions` — auth — add a list version snapshot — `SvhcListVersion`
- `GET /substances` — public — SVHC substances (?version_id) — `SvhcSubstance[]`
- `POST /substances` — auth — add SVHC substance — `SvhcSubstance`
- `DELETE /substances/:id` — auth — delete — `{success}`
- `GET /diff?from=&to=` — public — added substances between two versions — `{added:SvhcSubstance[]}`
- `GET /watch` — public — newly-affected products after latest additions — `{affected:[{product, substance}]}`

### 9. `exemptions.ts` → mount `exemptions`
- `GET /` — public — exemption catalog — `Exemption[]`
- `GET /expiring?days=90` — public — exemptions expiring within window + affected applied — `{exemptions:Exemption[], applied:AppliedExemption[]}`
- `POST /` — auth — add exemption — `Exemption`
- `PUT /:id` — auth — update — `Exemption`
- `DELETE /:id` — auth — delete — `{success}`
- `GET /applied` — public — applied exemptions (?workspace_id) — `AppliedExemption[]`
- `POST /applied` — auth — apply exemption to component/material {exemption_id, component_id, material_id, justification} — `AppliedExemption`
- `DELETE /applied/:id` — auth — remove applied exemption — `{success}`

### 10. `declarations.ts` → mount `declarations`
- `GET /` — public — declarations (?workspace_id, ?component_id, ?supplier_id, ?status) — `Declaration[]`
- `GET /:id` — public — declaration + captured substances — `{declaration, substances}`
- `POST /` — auth — create/intake declaration — `Declaration`
- `PUT /:id` — auth(owner) — update (status, validity, supersede) — `Declaration`
- `DELETE /:id` — auth(owner) — delete — `{success}`
- `POST /:id/substances` — auth — add captured substance row — `DeclarationSubstance`
- `DELETE /substances/:substanceId` — auth — delete substance row — `{success}`
- `GET /stale?days=365` — public — declarations stale/expiring — `Declaration[]`

### 11. `declaration-requests.ts` → mount `declaration-requests`
- `GET /` — public — request ledger (?workspace_id, ?status, ?supplier_id) — `DeclarationRequest[]`
- `GET /ledger` — public — who-has-and-hasn't-returned summary grouped by supplier — `{bySupplier:[{supplier, requested, received, outstanding}]}`
- `POST /` — auth — create request — `DeclarationRequest`
- `POST /bulk` — auth — bulk create across BOM/supplier {workspace_id, supplier_id?, product_id?, component_ids:[]} — `{created:n, requests:DeclarationRequest[]}`
- `PUT /:id` — auth(owner) — update status — `DeclarationRequest`
- `POST /:id/remind` — auth — increment reminder + set last_reminded_at — `DeclarationRequest`
- `DELETE /:id` — auth(owner) — delete — `{success}`

### 12. `compliance.ts` → mount `compliance`
- `GET /product/:productId` — public — latest computed result — `ComplianceResult`
- `POST /product/:productId/compute` — auth — run threshold engine, persist result, write audit + notifications on fail — `ComplianceResult`
- `POST /recompute-all` — auth — recompute every product in a workspace {workspace_id} — `{computed:n, results:ComplianceResult[]}`
- `GET /results` — public — all results (?workspace_id) — `ComplianceResult[]`

### 13. `scip.ts` → mount `scip`
- `GET /product/:productId` — public — SCIP-readiness: articles requiring notification (SVHC>0.1%) — `{product, articles:[{component, substance, concentration_ppm, location}], required}`
- `GET /` — public — workspace SCIP summary (?workspace_id) — `{products:[{product, required, articleCount}]}`

### 14. `packs.ts` → mount `packs`
- `GET /product/:productId` — public — assembled declaration pack (BOM, declarations, verdicts, exemptions) — `{product, bom, declarations, verdict, exemptions, certificate}`
- `POST /product/:productId/export` — auth — record an export + return pack payload — `{report, pack}`

### 15. `notifications.ts` → mount `notifications`
- `GET /` — public — current user's notifications (uses getUserId) — `Notification[]`
- `POST /:id/read` — auth — mark read — `Notification`
- `POST /read-all` — auth — mark all read — `{updated:n}`
- `DELETE /:id` — auth — delete — `{success}`

### 16. `tasks.ts` → mount `tasks`
- `GET /` — public — tasks (?workspace_id, ?status, ?product_id) — `Task[]`
- `GET /:id` — public — task detail — `Task`
- `POST /` — auth — create remediation task — `Task`
- `PUT /:id` — auth(owner) — update (status, assignee, due) — `Task`
- `DELETE /:id` — auth(owner) — delete — `{success}`

### 17. `audit.ts` → mount `audit`
- `GET /` — public — paginated audit/evidence log (?workspace_id, ?entity_type, ?entity_id, ?limit) — `AuditEvent[]`
- `GET /product/:productId` — public — evidence trail for a product — `AuditEvent[]`

### 18. `search.ts` → mount `search`
- `GET /?q=&workspace_id=` — public — global search across products, components, suppliers, substances — `{products, components, suppliers, substances}`
- `GET /substance?cas=&workspace_id=` — public — reverse lookup: every product/part containing a CAS — `{cas, hits:[{product, component, material, concentration_ppm}]}`

### 19. `dashboard.ts` → mount `dashboard`
- `GET /overview?workspace_id=` — public — portfolio counts (compliant/non-compliant/at-risk/incomplete), coverage trend, SVHC exposure, exemption runway — `{counts, coverageTrend, svhcExposure, exemptionRunway, supplierResponsiveness}`

### 20. `reports.ts` → mount `reports`
- `GET /` — public — report history (?workspace_id) — `Report[]`
- `GET /:id` — public — report detail — `Report`
- `POST /generate` — auth — generate a report {workspace_id, type} where type in (portfolio|scip|exemption-expiry|supplier-coverage) — `Report`
- `DELETE /:id` — auth(owner) — delete — `{success}`

### 21. `seed.ts` → mount `seed`
- `POST /` — auth — seed sample workspace data (products, BOMs, suppliers, declarations, restricted substances, SVHC list+substances, exemptions) for current user; includes a deliberately non-compliant product — `{workspace_id, seeded:{...counts}}`
- `GET /status?workspace_id=` — public — whether sample data present — `{seeded:boolean, counts}`

### 22. `billing.ts` → mount `billing`
- `GET /plan` — public(uses header user) — current subscription + plan + stripeEnabled — `{subscription, plan, stripeEnabled}`
- `POST /checkout` — auth — Stripe checkout or 503 — `{url}` | 503
- `POST /portal` — auth — Stripe portal or 503 — `{url}` | 503
- `POST /webhook` — (no auth, signature-verified) — Stripe webhook or 503 — `{received}` | 503

(Backend also serves `GET /health` at root, outside `/api/v1`.)

---

## (c) `web/lib/api.ts` method list

Each is `fetch('/api/proxy/<path>')`; path after `/api/proxy/` maps 1:1 to `/api/v1/<path>`. Export `default api`.

Workspaces:
- `listWorkspaces()` — GET `/api/proxy/workspaces`
- `getWorkspace(id)` — GET `/api/proxy/workspaces/:id`
- `createWorkspace(body)` — POST `/api/proxy/workspaces`
- `updateWorkspace(id, body)` — PUT `/api/proxy/workspaces/:id`
- `listMembers(id)` — GET `/api/proxy/workspaces/:id/members`
- `addMember(id, body)` — POST `/api/proxy/workspaces/:id/members`
- `removeMember(id, memberId)` — DELETE `/api/proxy/workspaces/:id/members/:memberId`

Suppliers:
- `listSuppliers(workspaceId?)` — GET `/api/proxy/suppliers`
- `getSupplier(id)` — GET `/api/proxy/suppliers/:id`
- `getSupplierScorecard(id)` — GET `/api/proxy/suppliers/:id/scorecard`
- `createSupplier(body)` — POST `/api/proxy/suppliers`
- `updateSupplier(id, body)` — PUT `/api/proxy/suppliers/:id`
- `deleteSupplier(id)` — DELETE `/api/proxy/suppliers/:id`
- `listSupplierContacts(id)` — GET `/api/proxy/suppliers/:id/contacts`
- `addSupplierContact(id, body)` — POST `/api/proxy/suppliers/:id/contacts`
- `deleteSupplierContact(id, contactId)` — DELETE `/api/proxy/suppliers/:id/contacts/:contactId`

Products:
- `listProducts(params?)` — GET `/api/proxy/products`
- `getProduct(id)` — GET `/api/proxy/products/:id`
- `createProduct(body)` — POST `/api/proxy/products`
- `updateProduct(id, body)` — PUT `/api/proxy/products/:id`
- `deleteProduct(id)` — DELETE `/api/proxy/products/:id`
- `getProductRollup(id)` — GET `/api/proxy/products/:id/rollup`

BOMs:
- `listBomVersions(productId)` — GET `/api/proxy/boms/product/:productId/versions`
- `createBomVersion(productId, body)` — POST `/api/proxy/boms/product/:productId/versions`
- `cloneBomVersion(productId, versionId)` — POST `/api/proxy/boms/product/:productId/clone/:versionId`
- `listBomItems(versionId)` — GET `/api/proxy/boms/versions/:versionId/items`
- `addBomItem(versionId, body)` — POST `/api/proxy/boms/versions/:versionId/items`
- `updateBomItem(itemId, body)` — PUT `/api/proxy/boms/items/:itemId`
- `deleteBomItem(itemId)` — DELETE `/api/proxy/boms/items/:itemId`
- `importBom(versionId, body)` — POST `/api/proxy/boms/versions/:versionId/import`

Components:
- `listComponents(params?)` — GET `/api/proxy/components`
- `getComponent(id)` — GET `/api/proxy/components/:id`
- `createComponent(body)` — POST `/api/proxy/components`
- `updateComponent(id, body)` — PUT `/api/proxy/components/:id`
- `deleteComponent(id)` — DELETE `/api/proxy/components/:id`

Materials:
- `listMaterials(componentId)` — GET `/api/proxy/materials/component/:componentId`
- `addMaterial(componentId, body)` — POST `/api/proxy/materials/component/:componentId`
- `updateMaterial(id, body)` — PUT `/api/proxy/materials/:id`
- `deleteMaterial(id)` — DELETE `/api/proxy/materials/:id`
- `listMaterialSubstances(id)` — GET `/api/proxy/materials/:id/substances`
- `addMaterialSubstance(id, body)` — POST `/api/proxy/materials/:id/substances`
- `deleteMaterialSubstance(substanceId)` — DELETE `/api/proxy/materials/substances/:substanceId`

Restricted substances:
- `listRestrictedSubstances()` — GET `/api/proxy/restricted-substances`
- `getRestrictedSubstance(id)` — GET `/api/proxy/restricted-substances/:id`
- `createRestrictedSubstance(body)` — POST `/api/proxy/restricted-substances`
- `updateRestrictedSubstance(id, body)` — PUT `/api/proxy/restricted-substances/:id`
- `deleteRestrictedSubstance(id)` — DELETE `/api/proxy/restricted-substances/:id`

SVHC:
- `listSvhcVersions()` — GET `/api/proxy/svhc/versions`
- `createSvhcVersion(body)` — POST `/api/proxy/svhc/versions`
- `listSvhcSubstances(versionId?)` — GET `/api/proxy/svhc/substances`
- `createSvhcSubstance(body)` — POST `/api/proxy/svhc/substances`
- `deleteSvhcSubstance(id)` — DELETE `/api/proxy/svhc/substances/:id`
- `svhcDiff(from, to)` — GET `/api/proxy/svhc/diff`
- `svhcWatch()` — GET `/api/proxy/svhc/watch`

Exemptions:
- `listExemptions()` — GET `/api/proxy/exemptions`
- `listExpiringExemptions(days?)` — GET `/api/proxy/exemptions/expiring`
- `createExemption(body)` — POST `/api/proxy/exemptions`
- `updateExemption(id, body)` — PUT `/api/proxy/exemptions/:id`
- `deleteExemption(id)` — DELETE `/api/proxy/exemptions/:id`
- `listAppliedExemptions(workspaceId?)` — GET `/api/proxy/exemptions/applied`
- `applyExemption(body)` — POST `/api/proxy/exemptions/applied`
- `removeAppliedExemption(id)` — DELETE `/api/proxy/exemptions/applied/:id`

Declarations:
- `listDeclarations(params?)` — GET `/api/proxy/declarations`
- `getDeclaration(id)` — GET `/api/proxy/declarations/:id`
- `createDeclaration(body)` — POST `/api/proxy/declarations`
- `updateDeclaration(id, body)` — PUT `/api/proxy/declarations/:id`
- `deleteDeclaration(id)` — DELETE `/api/proxy/declarations/:id`
- `addDeclarationSubstance(id, body)` — POST `/api/proxy/declarations/:id/substances`
- `deleteDeclarationSubstance(substanceId)` — DELETE `/api/proxy/declarations/substances/:substanceId`
- `listStaleDeclarations(days?)` — GET `/api/proxy/declarations/stale`

Declaration requests:
- `listDeclarationRequests(params?)` — GET `/api/proxy/declaration-requests`
- `getRequestLedger()` — GET `/api/proxy/declaration-requests/ledger`
- `createDeclarationRequest(body)` — POST `/api/proxy/declaration-requests`
- `bulkCreateRequests(body)` — POST `/api/proxy/declaration-requests/bulk`
- `updateDeclarationRequest(id, body)` — PUT `/api/proxy/declaration-requests/:id`
- `remindRequest(id)` — POST `/api/proxy/declaration-requests/:id/remind`
- `deleteDeclarationRequest(id)` — DELETE `/api/proxy/declaration-requests/:id`

Compliance:
- `getCompliance(productId)` — GET `/api/proxy/compliance/product/:productId`
- `computeCompliance(productId)` — POST `/api/proxy/compliance/product/:productId/compute`
- `recomputeAll(body)` — POST `/api/proxy/compliance/recompute-all`
- `listComplianceResults(workspaceId?)` — GET `/api/proxy/compliance/results`

SCIP:
- `getScipProduct(productId)` — GET `/api/proxy/scip/product/:productId`
- `getScipSummary(workspaceId?)` — GET `/api/proxy/scip`

Packs:
- `getPack(productId)` — GET `/api/proxy/packs/product/:productId`
- `exportPack(productId)` — POST `/api/proxy/packs/product/:productId/export`

Notifications:
- `listNotifications()` — GET `/api/proxy/notifications`
- `markNotificationRead(id)` — POST `/api/proxy/notifications/:id/read`
- `markAllNotificationsRead()` — POST `/api/proxy/notifications/read-all`
- `deleteNotification(id)` — DELETE `/api/proxy/notifications/:id`

Tasks:
- `listTasks(params?)` — GET `/api/proxy/tasks`
- `getTask(id)` — GET `/api/proxy/tasks/:id`
- `createTask(body)` — POST `/api/proxy/tasks`
- `updateTask(id, body)` — PUT `/api/proxy/tasks/:id`
- `deleteTask(id)` — DELETE `/api/proxy/tasks/:id`

Audit:
- `listAudit(params?)` — GET `/api/proxy/audit`
- `getProductAudit(productId)` — GET `/api/proxy/audit/product/:productId`

Search:
- `search(q, workspaceId?)` — GET `/api/proxy/search`
- `substanceLookup(cas, workspaceId?)` — GET `/api/proxy/search/substance`

Dashboard:
- `getOverview(workspaceId?)` — GET `/api/proxy/dashboard/overview`

Reports:
- `listReports(workspaceId?)` — GET `/api/proxy/reports`
- `getReport(id)` — GET `/api/proxy/reports/:id`
- `generateReport(body)` — POST `/api/proxy/reports/generate`
- `deleteReport(id)` — DELETE `/api/proxy/reports/:id`

Seed:
- `seedSampleData()` — POST `/api/proxy/seed`
- `getSeedStatus(workspaceId?)` — GET `/api/proxy/seed/status`

Billing:
- `getBillingPlan()` — GET `/api/proxy/billing/plan`
- `startCheckout()` — POST `/api/proxy/billing/checkout`
- `openPortal()` — POST `/api/proxy/billing/portal`

---

## (d) Pages (URL → file → kind → api methods → renders)

Public:
1. `/` — `web/app/page.tsx` — public — (none, static) — landing marketing: hero, feature grid, CTAs.
2. `/auth/sign-in` — `web/app/auth/sign-in/page.tsx` — public — authClient.signIn — sign-in form (client onSubmit).
3. `/auth/sign-up` — `web/app/auth/sign-up/page.tsx` — public — authClient.signUp — sign-up form (client onSubmit).
4. `/pricing` — `web/app/pricing/page.tsx` — public — getBillingPlan, startCheckout — plan cards + upgrade CTA.

Dashboard (under `web/app/dashboard/*`, wrapped by `dashboard/layout.tsx` → DashboardLayout):
5. `/dashboard` — `web/app/dashboard/page.tsx` — dashboard — getOverview, listProducts — portfolio overview: status counts, coverage trend, SVHC exposure, exemption runway.
6. `/dashboard/products` — `web/app/dashboard/products/page.tsx` — dashboard — listProducts, createProduct, deleteProduct — product list with status badges + create.
7. `/dashboard/products/[id]` — `web/app/dashboard/products/[id]/page.tsx` — dashboard — getProductRollup, getCompliance, computeCompliance, getProductAudit — roll-up verdict, offending part/substance, drill-down, recompute, evidence.
8. `/dashboard/products/[id]/bom` — `web/app/dashboard/products/[id]/bom/page.tsx` — dashboard — listBomVersions, createBomVersion, cloneBomVersion, listBomItems, addBomItem, updateBomItem, deleteBomItem, importBom, listComponents — BOM tree editor + CSV import.
9. `/dashboard/components` — `web/app/dashboard/components/page.tsx` — dashboard — listComponents, createComponent, deleteComponent, listSuppliers — component catalog list + create + filter.
10. `/dashboard/components/[id]` — `web/app/dashboard/components/[id]/page.tsx` — dashboard — getComponent, updateComponent, listMaterials, addMaterial, updateMaterial, deleteMaterial, listMaterialSubstances, addMaterialSubstance, deleteMaterialSubstance — materials + substance composition editor.
11. `/dashboard/suppliers` — `web/app/dashboard/suppliers/page.tsx` — dashboard — listSuppliers, createSupplier, deleteSupplier — supplier directory.
12. `/dashboard/suppliers/[id]` — `web/app/dashboard/suppliers/[id]/page.tsx` — dashboard — getSupplier, updateSupplier, getSupplierScorecard, listSupplierContacts, addSupplierContact, deleteSupplierContact — supplier detail + scorecard + contacts.
13. `/dashboard/declarations` — `web/app/dashboard/declarations/page.tsx` — dashboard — listDeclarations, createDeclaration, getDeclaration, updateDeclaration, deleteDeclaration, addDeclarationSubstance, deleteDeclarationSubstance, listStaleDeclarations, listComponents, listSuppliers — declarations list + intake + substance capture.
14. `/dashboard/declaration-requests` — `web/app/dashboard/declaration-requests/page.tsx` — dashboard — listDeclarationRequests, getRequestLedger, createDeclarationRequest, bulkCreateRequests, updateDeclarationRequest, remindRequest, deleteDeclarationRequest, listSuppliers — collection workflow ledger + reminders.
15. `/dashboard/restricted-substances` — `web/app/dashboard/restricted-substances/page.tsx` — dashboard — listRestrictedSubstances, createRestrictedSubstance, updateRestrictedSubstance, deleteRestrictedSubstance — RoHS catalog CRUD.
16. `/dashboard/svhc` — `web/app/dashboard/svhc/page.tsx` — dashboard — listSvhcVersions, createSvhcVersion, listSvhcSubstances, createSvhcSubstance, deleteSvhcSubstance, svhcDiff, svhcWatch — SVHC list, version diff, newly-affected watch.
17. `/dashboard/exemptions` — `web/app/dashboard/exemptions/page.tsx` — dashboard — listExemptions, listExpiringExemptions, createExemption, updateExemption, deleteExemption, listAppliedExemptions, applyExemption, removeAppliedExemption, listComponents — exemption catalog + expiry calendar + apply.
18. `/dashboard/compliance` — `web/app/dashboard/compliance/page.tsx` — dashboard — listComplianceResults, recomputeAll, computeCompliance — threshold-engine results table + recompute.
19. `/dashboard/scip` — `web/app/dashboard/scip/page.tsx` — dashboard — getScipSummary, getScipProduct — SCIP readiness summary + per-product articles.
20. `/dashboard/packs` — `web/app/dashboard/packs/page.tsx` — dashboard — listProducts, getPack, exportPack — declaration-pack assembly + export.
21. `/dashboard/tasks` — `web/app/dashboard/tasks/page.tsx` — dashboard — listTasks, getTask, createTask, updateTask, deleteTask — remediation tasks board.
22. `/dashboard/notifications` — `web/app/dashboard/notifications/page.tsx` — dashboard — listNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification — alerts feed.
23. `/dashboard/audit` — `web/app/dashboard/audit/page.tsx` — dashboard — listAudit — audit/evidence log.
24. `/dashboard/reports` — `web/app/dashboard/reports/page.tsx` — dashboard — listReports, getReport, generateReport, deleteReport — reports center.
25. `/dashboard/search` — `web/app/dashboard/search/page.tsx` — dashboard — search, substanceLookup — global search + CAS reverse lookup.
26. `/dashboard/settings` — `web/app/dashboard/settings/page.tsx` — dashboard — getWorkspace, updateWorkspace, listMembers, addMember, removeMember, getBillingPlan, startCheckout, openPortal, seedSampleData, getSeedStatus — workspace settings, members, billing, sample-data seeder.

Plus route handlers (not pages): `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` ('use client', `usePathname()` active state, mobile drawer). Sections:

- **Overview**
  - Dashboard → `/dashboard`
- **Products & BOM**
  - Products → `/dashboard/products`
  - Component Catalog → `/dashboard/components`
- **Suppliers & Declarations**
  - Suppliers → `/dashboard/suppliers`
  - Declarations → `/dashboard/declarations`
  - Declaration Requests → `/dashboard/declaration-requests`
- **Compliance**
  - Compliance Engine → `/dashboard/compliance`
  - SCIP Readiness → `/dashboard/scip`
  - Declaration Packs → `/dashboard/packs`
- **Regulatory Lists**
  - RoHS Substances → `/dashboard/restricted-substances`
  - SVHC Watch → `/dashboard/svhc`
  - Exemptions → `/dashboard/exemptions`
- **Operations**
  - Tasks → `/dashboard/tasks`
  - Notifications → `/dashboard/notifications`
  - Reports → `/dashboard/reports`
  - Audit Log → `/dashboard/audit`
  - Search → `/dashboard/search`
- **Account**
  - Settings → `/dashboard/settings`

---

## Consistency notes (binding)

- Every api method maps to exactly one backend endpoint and is consumed by at least one page (verified: all 22 route files, all methods used by a page above).
- Threshold engine (`compliance.ts/compute`) is deterministic: per homogeneous material, `concentration_ppm` vs `restricted_substances.max_concentration_ppm` (RoHS, homogeneous-material basis) and vs `svhc_substances.article_threshold_ppm` default 1000 ppm = 0.1% (REACH article basis), honoring `applied_exemptions` (skip a restricted substance on a component/material that has a non-expired applied exemption). It sets `products.compliance_status`, writes `compliance_results`, an `audit_events` row, and a `notifications` row on failure.
- 22 route files, 26 pages (4 public + 22 dashboard).
