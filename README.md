# RoHS/REACH Substance Declaration Ledger

RohsReachSubstanceDeclarationLedger is a materials-compliance platform that proves every product a manufacturer or importer ships into the EU/UK is RoHS and REACH compliant. It ingests a product's bill of materials (BOM) down to the component and homogeneous-material level, collects a supplier material declaration for every part, and deterministically computes whether any restricted substance (RoHS Annex II) or REACH SVHC exceeds its legal concentration threshold.

The platform tracks the twice-yearly growth of the SVHC candidate list and the expiry of RoHS exemptions, re-flagging affected products automatically, and produces declaration packs and SCIP-notification-readiness reports.

The product is a substances ledger: every gram of restricted chemistry in a physical product is traced from the legal substance list, through the supplier declaration, to the homogeneous material, to the component, to the finished product, with a roll-up compliance verdict and a clear pointer to the offending part when a product fails.

See [docs/idea.md](docs/idea.md) for the full product specification and feature breakdown.

## Stack

- **Backend:** Node.js with TypeScript, run via tsx. Postgres (Neon) for persistence with Drizzle ORM.
- **Frontend:** Next.js 15+, React 19+, TypeScript (strict), Tailwind 4, App Router. Located at `web/`.
- **Auth:** Neon Auth.
- **Package manager:** pnpm everywhere.

## Local Development

Prerequisites: Node.js 22.x, pnpm, and a Postgres database (a Neon connection string works).

### Backend

```bash
cd backend
pnpm install
# create backend/.env with DATABASE_URL and PORT (see Environment Variables)
node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (default 3001 locally).

### Frontend

```bash
cd web
pnpm install
# create web/.env.local with NEXT_PUBLIC_API_URL and the Neon Auth vars
pnpm dev
```

The web app runs on http://localhost:3000 and talks to the backend at `NEXT_PUBLIC_API_URL`.

### Docker

```bash
docker compose up --build
```

This brings up the backend (port 3001) and web (port 3000) together.

## Environment Variables

### Backend

| Variable        | Required | Description                                      |
| --------------- | -------- | ------------------------------------------------ |
| `DATABASE_URL`  | yes      | Postgres connection string.                      |
| `PORT`          | yes      | Port the backend listens on (10000 on Render).   |
| `FRONTEND_URL`  | yes      | Origin of the web app, used for CORS.            |
| `NODE_ENV`      | no       | `production` in deployed environments.           |

### Frontend (`web/.env.local`)

| Variable                | Required | Description                                   |
| ----------------------- | -------- | --------------------------------------------- |
| `NEXT_PUBLIC_API_URL`   | yes      | Base URL of the backend API.                  |
| `NEON_AUTH_*`           | yes      | Neon Auth configuration for sign-in/sign-up.  |

## Pricing

All features are free for signed-in users. Anyone with an account has full access to BOM import, the component and material catalog, the substance threshold engine, SVHC-list and exemption watching, declaration collection, and reporting. There are no paid tiers or feature gates.

## Deployment

- **Backend:** Render web service (see `render.yaml`). Build with `cd backend && pnpm install`, start with `cd backend && node --import tsx/esm src/index.ts`. Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend:** Vercel, with `rootDirectory` set to `web`, framework `nextjs`, Node 22.x.
