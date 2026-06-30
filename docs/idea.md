# RoHS/REACH Substance Declaration Ledger

## Overview

RohsReachSubstanceDeclarationLedger is a materials-compliance platform that proves every product a manufacturer or importer ships into the EU/UK is RoHS and REACH compliant. It does this by ingesting a product's bill of materials (BOM) down to the component and homogeneous-material level, collecting a supplier material declaration for every part, and then deterministically computing whether any restricted substance (RoHS Annex II) or REACH SVHC (Substance of Very High Concern) exceeds its legal concentration threshold. The platform tracks the twice-yearly growth of the SVHC candidate list and the expiry of RoHS exemptions, re-flagging affected products automatically, and produces declaration packs and SCIP-notification-readiness reports that satisfy regulators and large OEM/retail customers.

The product is a **substances ledger**: every gram of restricted chemistry in a physical product is traced from the legal substance list, through the supplier declaration, to the homogeneous material, to the component, to the finished product, with a roll-up compliance verdict and a clear pointer to the offending part when a product fails.

## Problem

RoHS (Restriction of Hazardous Substances) and REACH (Registration, Evaluation, Authorisation and Restriction of Chemicals) legally restrict named substances in products sold in the EU and UK. Non-compliance blocks market access, triggers fines, forces recalls, and damages brand reputation. Large OEM and retail customers increasingly demand documented substance declarations as a precondition of purchase.

The compliance burden is continuous, not one-time:

- The REACH SVHC candidate list grows roughly twice a year; the moment a substance is added, any article containing it above 0.1% by weight triggers communication and (above one tonne/year) SCIP notification obligations.
- RoHS exemptions (which permit otherwise-restricted substances in specific applications, e.g. lead in certain solders) expire on fixed dates and must be renewed or designed out.
- Modern electronics and durable-goods BOMs are deep and multi-supplier; a single product can have hundreds of parts, each from a different vendor, each requiring a current material declaration.
- Declarations arrive in inconsistent formats (IPC-1752A, IEC 62474, free-form PDF, spreadsheets) and go stale as suppliers change formulations.

Engineers today manage this with spreadsheets, email chains, and shared drives. There is no single ledger that ties the legal substance lists to the BOM and computes a defensible pass/fail.

## Target Users

- **Materials-compliance engineers** at electronics, toy, and durable-goods manufacturers who own the RoHS/REACH program.
- **Supply-chain-quality engineers** who chase hundreds of supplier material declarations and track who has and has not returned them.
- **Importers** who must demonstrate compliance for products they did not design but are legally responsible for placing on the EU/UK market.
- **Product compliance managers** who sign the EU Declaration of Conformity and need an auditable evidence trail.

**Buyer:** the materials-compliance or supply-chain-quality engineer at a hardware manufacturer or importer. The function is budgeted, the ROI is clear market access, and the demand is a legal precondition plus a customer purchase condition.

## Why this is NOT an existing project

Near-neighbors and why we are distinct:

- **SBOM generators / dependency-audit tools (Snyk, Dependabot, Syft):** these concern *software* components and CVEs. We ingest a *hardware* BOM and physical *chemical* declarations. There is no overlap in data model or computation.
- **Generic supplier / vendor portals (SAP Ariba, Coupa):** these are procurement and vendor-communication tools. They do not model homogeneous materials, restricted-substance thresholds, or RoHS exemptions, and they do not compute a regulatory pass/fail.
- **PLM suites (Arena, Windchill) with a compliance add-on:** heavyweight, expensive, and the compliance module is a bolt-on. We are a focused, demoable ledger that does one thing: substance compliance.
- **The `ai-act-keeper` venture (sibling):** that tracks *AI systems* against the EU AI Act. This tracks *physical substances* in hardware against RoHS/REACH. Entirely different regulation, data model, and computation. No shared tables.
- **Spreadsheet + email (the status quo):** no roll-up, no automatic SVHC re-flagging, no exemption-expiry tracking, no audit trail.

Our differentiator is the **deterministic threshold engine** over a **homogeneous-material substance ledger**, combined with **continuous SVHC-list and exemption-expiry watching** and **declaration-collection workflow**, all in one product with seeded sample BOMs for instant demoability.

## Major Feature Sections

### 1. Product & BOM Importer
- Create products with metadata (name, SKU, part number, category, market region, lifecycle status).
- Build the component tree per product: components, sub-assemblies, and homogeneous materials.
- CSV/spreadsheet BOM import with column mapping (part number, description, supplier, quantity, mass, parent).
- Manual part entry and tree editing (add/move/delete nodes, re-parent).
- Per-part mass and quantity capture (homogeneous-material mass is the denominator for threshold math).
- BOM versioning and revision history; clone a BOM to a new revision.
- Seeded sample BOMs (an LED lamp, a toy, a power adapter) for instant demo.

### 2. Component & Material Catalog
- Reusable component library shared across products (a resistor used in 40 products is one catalog entry).
- Homogeneous-material breakdown per component (housing, solder, plating, substrate).
- Material-to-substance composition records (substance + concentration ppm/% within the material).
- Supplier linkage: each catalog component has a manufacturer and supplier.
- Search and filter the catalog by substance presence, supplier, or compliance status.

### 3. Supplier Management
- Supplier directory (name, contact, region, declaration formats accepted).
- Per-supplier declaration coverage dashboard (parts supplied vs. declarations on file).
- Supplier scorecard: responsiveness, declaration freshness, pass rate.
- Supplier contact roles and escalation contacts.

### 4. Declaration Collection Workflow
- Create declaration requests targeting a supplier for one or many parts.
- Request status ledger: requested, reminded, received, validated, rejected, expired.
- Automated reminder scheduling and a "who has and hasn't returned" view.
- Bulk request creation across a whole BOM or supplier.
- Declaration intake: attach a declaration document and capture its substance data.
- Declaration validity windows (valid-from / valid-until) and staleness detection.

### 5. Declaration Parsing & Capture
- Structured declaration entry following IPC-1752A / IEC 62474 fields.
- Per-substance concentration capture against a homogeneous material.
- Declaration format tagging (IPC-1752A, IEC 62474, full-material, free-form).
- Declaration revisions and supersession (a new declaration replaces an old one).
- Confidence / data-quality flags on captured declarations.

### 6. Restricted-Substance Catalog (RoHS Annex II)
- Maintain the RoHS restricted-substance list with per-substance maximum concentration values (e.g. lead 0.1%, cadmium 0.01%).
- Substance metadata: CAS number, EC number, restriction basis, threshold, threshold basis (homogeneous material).
- Versioned restriction list (RoHS 2 vs. RoHS 3 phthalate additions).

### 7. REACH SVHC Candidate List
- Maintain the SVHC candidate list with date-of-inclusion per substance.
- The 0.1%-by-weight article threshold rule.
- SVHC substance metadata: CAS, EC, reason for inclusion (CMR, PBT, vPvB, endocrine).
- Candidate-list version history; each twice-yearly update is a versioned snapshot.

### 8. Threshold Engine (core compute)
- Deterministic computation: for each homogeneous material, compare each declared substance concentration against its applicable RoHS / SVHC threshold.
- Roll material verdicts up to component, sub-assembly, and product level.
- RoHS verdict (per restricted substance, homogeneous-material basis) and REACH SVHC verdict (0.1% article basis).
- Identify the single offending part and substance that drives a product failure.
- Recompute on demand and automatically when inputs change (declaration, list, exemption).

### 9. SVHC Candidate-List Watch
- When a new SVHC substance is added, re-scan all products and re-flag any that now contain it above threshold.
- "Newly affected products" feed after each list update.
- Diff view between candidate-list versions (added substances).
- Per-product SVHC exposure timeline.

### 10. RoHS Exemption Tracker
- Catalog of RoHS exemptions (exemption number, scope, applies-to-application, expiry date).
- Attach an exemption to a component/material that would otherwise fail.
- Expiry calendar and "expiring in 90 days" alerts.
- Re-flag products when an applied exemption expires.

### 11. Product Compliance Roll-Up & Status
- Per-product compliance dashboard: overall verdict, offending part, blocking substances.
- Status badges (compliant, non-compliant, at-risk, incomplete-data).
- Drill-down from product to component to material to substance.
- Coverage metric: percentage of BOM parts with a current valid declaration.

### 12. SCIP / Notification-Readiness Reporting
- Identify articles requiring SCIP notification (SVHC > 0.1% in an article placed on the EU market).
- SCIP-readiness report per product (article identifier, substance, concentration, location).
- Notification checklist and export of the required data fields.

### 13. Declaration-Pack Export
- Generate a declaration pack per product: BOM, declarations, verdicts, exemptions, evidence.
- Export formats (JSON/CSV summary) suitable for sharing with customers or auditors.
- Customer-facing compliance certificate summary.

### 14. Alerts & Notifications
- In-app notifications for: new SVHC additions affecting your products, exemptions expiring, declarations going stale, requests overdue.
- Per-user notification feed with read/unread state.
- Notification preferences.

### 15. Audit Trail & Evidence Log
- Immutable event log of every compliance-relevant action (declaration received, verdict computed, exemption applied, list updated).
- Per-product evidence trail for a Declaration of Conformity.
- Who-changed-what history.

### 16. Tasks & Remediation
- Remediation tasks raised against failing products/parts (find alternate part, request new declaration, apply exemption).
- Task assignment, status, due dates.
- Link tasks to the offending part/substance.

### 17. Search & Substance Lookup
- Global search across products, parts, suppliers, substances.
- "Where is this substance?" reverse lookup: given a CAS number, list every product/part containing it.
- Filter products by compliance status, region, or supplier.

### 18. Dashboards & Analytics
- Portfolio compliance overview (compliant vs. non-compliant vs. incomplete).
- Declaration-coverage trend, supplier responsiveness, SVHC exposure counts.
- Exemption-expiry runway chart.

### 19. Workspace & Team Settings
- Workspace profile (company, market regions, default thresholds).
- Member list and roles (the workspace owner controls settings).
- API/integration settings placeholder.

### 20. Sample-Data Seeder & Demo Mode
- One-click seeding of sample products, BOMs, suppliers, declarations, restricted substances, SVHC entries, and exemptions.
- Demo walkthrough surfacing a deliberately non-compliant product (e.g. lead in solder above threshold) to showcase the offending-part roll-up.

### 21. Billing (Stripe-optional)
- Free plan with all features for signed-in users.
- Pro plan scaffolding; Stripe endpoints return 503 when unconfigured.

### 22. Reports Center
- Saved/generated reports: portfolio status, SCIP readiness, exemption expiry, supplier coverage.
- Report history and re-generation.

## Data Model (tables)

- `workspaces` — tenant/company workspace.
- `workspace_members` — user membership + role in a workspace.
- `suppliers` — supplier directory.
- `supplier_contacts` — contacts per supplier.
- `products` — finished products under compliance.
- `bom_versions` — BOM revisions per product.
- `components` — catalog components (reusable).
- `bom_items` — a component placed in a product BOM tree (parent/child, qty, mass).
- `materials` — homogeneous materials within a component.
- `material_substances` — substance + concentration within a material.
- `restricted_substances` — RoHS Annex II restricted-substance catalog.
- `svhc_substances` — REACH SVHC candidate-list entries.
- `svhc_list_versions` — versioned candidate-list snapshots.
- `exemptions` — RoHS exemption catalog.
- `applied_exemptions` — exemption applied to a component/material.
- `declarations` — supplier material declarations.
- `declaration_substances` — substance rows captured from a declaration.
- `declaration_requests` — collection-workflow request ledger.
- `compliance_results` — computed verdicts per product/part.
- `notifications` — per-user alerts.
- `audit_events` — immutable evidence/audit log.
- `tasks` — remediation tasks.
- `reports` — generated report records.
- `plans` — billing plans.
- `subscriptions` — per-user subscription.

## API Surface (high level)

- `/api/v1/workspaces` — workspace CRUD + members.
- `/api/v1/suppliers` — supplier directory + contacts + scorecard.
- `/api/v1/products` — products CRUD + roll-up status.
- `/api/v1/boms` — BOM versions + tree items.
- `/api/v1/components` — component catalog.
- `/api/v1/materials` — materials + substance composition.
- `/api/v1/restricted-substances` — RoHS catalog.
- `/api/v1/svhc` — SVHC candidate list + versions + watch.
- `/api/v1/exemptions` — exemptions + applied exemptions + expiry.
- `/api/v1/declarations` — declarations + captured substances.
- `/api/v1/declaration-requests` — collection workflow.
- `/api/v1/compliance` — threshold-engine compute + results.
- `/api/v1/scip` — SCIP readiness.
- `/api/v1/packs` — declaration-pack export.
- `/api/v1/notifications` — alerts.
- `/api/v1/tasks` — remediation tasks.
- `/api/v1/audit` — audit/evidence log.
- `/api/v1/search` — global + substance reverse lookup.
- `/api/v1/dashboard` — portfolio analytics.
- `/api/v1/reports` — reports center.
- `/api/v1/seed` — sample-data seeder.
- `/api/v1/billing` — Stripe-optional billing.

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — pricing (static + billing CTA).

Dashboard (auth-gated under `/dashboard`):
5. `/dashboard` — portfolio compliance overview.
6. `/dashboard/products` — product list with status badges.
7. `/dashboard/products/[id]` — product roll-up + offending part drill-down.
8. `/dashboard/products/[id]/bom` — BOM tree editor.
9. `/dashboard/components` — component catalog.
10. `/dashboard/components/[id]` — component materials + substances.
11. `/dashboard/suppliers` — supplier directory + scorecards.
12. `/dashboard/suppliers/[id]` — supplier detail + coverage.
13. `/dashboard/declarations` — declarations list + intake.
14. `/dashboard/declaration-requests` — collection workflow ledger.
15. `/dashboard/restricted-substances` — RoHS catalog.
16. `/dashboard/svhc` — SVHC candidate list + watch + version diff.
17. `/dashboard/exemptions` — exemptions + expiry calendar.
18. `/dashboard/compliance` — threshold-engine results / recompute.
19. `/dashboard/scip` — SCIP readiness report.
20. `/dashboard/packs` — declaration-pack export.
21. `/dashboard/tasks` — remediation tasks.
22. `/dashboard/notifications` — alerts feed.
23. `/dashboard/audit` — audit/evidence log.
24. `/dashboard/reports` — reports center.
25. `/dashboard/search` — global + substance reverse lookup.
26. `/dashboard/settings` — workspace + billing + seed.
