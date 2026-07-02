import Link from 'next/link'

const features = [
  {
    title: 'Product & BOM Importer',
    body: 'Build the component tree per product down to homogeneous materials. CSV import with column mapping, manual tree editing, and BOM versioning with revision cloning.',
  },
  {
    title: 'Component & Material Catalog',
    body: 'A reusable component library shared across products, with per-component homogeneous-material breakdown and material-to-substance composition records.',
  },
  {
    title: 'Supplier Management',
    body: 'Supplier directory with declaration-coverage dashboards, responsiveness scorecards, declaration freshness, pass rate, and escalation contacts.',
  },
  {
    title: 'Declaration Collection Workflow',
    body: 'Create and bulk-create declaration requests across a BOM, track requested / reminded / received / validated status, and detect stale declarations.',
  },
  {
    title: 'Restricted-Substance Catalog',
    body: 'Maintain the RoHS Annex II list with per-substance maximum concentrations, CAS and EC numbers, restriction basis, and versioned restriction lists.',
  },
  {
    title: 'REACH SVHC Candidate List',
    body: 'Track the twice-yearly SVHC candidate list with date of inclusion, reason for inclusion, and the 0.1%-by-weight article threshold rule.',
  },
  {
    title: 'Deterministic Threshold Engine',
    body: 'Compare every declared substance concentration against its RoHS or SVHC threshold, roll verdicts up to the product, and pinpoint the single offending part and substance.',
  },
  {
    title: 'SVHC Candidate-List Watch',
    body: 'When a new SVHC substance is added, re-scan all products, surface a newly-affected-products feed, and diff candidate-list versions.',
  },
  {
    title: 'RoHS Exemption Tracker',
    body: 'Catalog RoHS exemptions, attach them to components that would otherwise fail, and get an expiry calendar with expiring-in-90-days alerts.',
  },
  {
    title: 'Compliance Roll-Up & Status',
    body: 'Per-product overall verdict, blocking substances, status badges, drill-down from product to material, and a BOM declaration-coverage metric.',
  },
  {
    title: 'SCIP Notification-Readiness',
    body: 'Identify articles requiring SCIP notification (SVHC above 0.1%) and generate a readiness report per product with article, substance, and location.',
  },
  {
    title: 'Declaration Packs & Audit Trail',
    body: 'Assemble exportable declaration packs (BOM, declarations, verdicts, exemptions) and keep a full evidence trail for the EU Declaration of Conformity.',
  },
]

const steps = [
  { n: '01', title: 'Import the BOM', body: 'Bring in the component tree and homogeneous materials, by CSV or by hand.' },
  { n: '02', title: 'Collect declarations', body: 'Request and capture supplier material declarations for every part.' },
  { n: '03', title: 'Compute compliance', body: 'Run the deterministic threshold engine against RoHS and REACH SVHC lists.' },
  { n: '04', title: 'Ship the evidence', body: 'Export declaration packs and SCIP-readiness reports regulators accept.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="h-2.5 w-2.5 rounded-sm bg-yellow-400" />
          RohsReachSubstanceDeclarationLedger
        </span>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-yellow-400"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-yellow-600/40 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-300">
          RoHS · REACH · SVHC · SCIP
        </span>
        <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Establish a defensible record of{' '}
          <span className="text-yellow-400">substance compliance</span>, part by part.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          This ledger maintains the chain of evidence required for RoHS and REACH conformity: the restricted-substance
          list, the supplier declaration, the homogeneous material, and the finished product, each tied to the next
          and evaluated against a deterministic pass/fail rule with the offending part identified.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-500 px-6 py-3 font-semibold text-slate-950 transition-colors hover:bg-yellow-400"
          >
            Open a workspace
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Compliance obligations do not close, they recur</h2>
          <p className="mt-3 max-w-3xl text-slate-400">
            A failure to demonstrate substance compliance can block market access in the EU and UK, expose the
            organization to penalties, and precipitate a recall. The SVHC candidate list is revised twice yearly,
            RoHS exemptions carry fixed expiry dates, and multi-tier bills of materials require a current declaration
            for every constituent part. Where this is tracked in spreadsheets and email correspondence, the record is
            incomplete and difficult to defend under audit. This system is built to close that gap: one ledger that
            ties the governing substance lists to the bill of materials and produces a pass/fail determination that
            can be substantiated.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
              <div className="text-sm font-semibold text-yellow-300">Biannual SVHC revisions</div>
              <p className="mt-1 text-sm text-slate-500">
                Each addition to the candidate list creates an immediate obligation to notify affected articles and
                assess SCIP exposure.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
              <div className="text-sm font-semibold text-yellow-300">Exemption expiry dates</div>
              <p className="mt-1 text-sm text-slate-500">
                RoHS exemptions must be renewed or engineered out ahead of their fixed expiry, or the affected
                products are re-flagged as non-compliant.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
              <div className="text-sm font-semibold text-yellow-300">Declaration currency</div>
              <p className="mt-1 text-sm text-slate-500">
                IPC-1752A and IEC 62474 declarations, PDFs, and spreadsheets fall out of date as supplier
                formulations change without notice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold tracking-tight">The compliance record, in four stages</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="text-xs font-bold text-yellow-400">{s.n}</div>
              <div className="mt-2 font-semibold text-slate-100">{s.title}</div>
              <p className="mt-1 text-sm text-slate-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-slate-800 bg-slate-900/30">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight">One system of record, from BOM to SCIP filing</h2>
          <p className="mt-2 max-w-2xl text-slate-400">
            From BOM import through SCIP readiness, every capability required to build and defend the compliance
            record lives in a single auditable system, with sample data seeded for immediate review.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-950/50 p-6">
                <h3 className="font-semibold text-slate-100">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight">Replace the spreadsheet with a system of record</h2>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Import a bill of materials, collect the outstanding declarations, and produce a defensible RoHS and REACH
          determination today. Every capability is included at no charge.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-500 px-6 py-3 font-semibold text-slate-950 transition-colors hover:bg-yellow-400"
          >
            Open a workspace
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
          >
            Review pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p className="flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-yellow-500/70" />
          RohsReachSubstanceDeclarationLedger
        </p>
        <p className="mt-2">A defensible record of RoHS and REACH substance compliance, part by part.</p>
      </footer>
    </main>
  )
}
