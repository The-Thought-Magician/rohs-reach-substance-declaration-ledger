'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const included = [
  'Unlimited products and bills of materials',
  'BOM importer with CSV column mapping and versioning',
  'Reusable component and homogeneous-material catalog',
  'Supplier directory, scorecards, and contacts',
  'Declaration collection workflow with reminders',
  'RoHS Annex II restricted-substance catalog',
  'REACH SVHC candidate-list tracking and version diffs',
  'Deterministic RoHS / REACH threshold engine',
  'SVHC candidate-list watch and newly-affected feed',
  'RoHS exemption tracker with expiry alerts',
  'SCIP notification-readiness reports',
  'Declaration packs, audit trail, and report center',
]

export default function Pricing() {
  const [planName, setPlanName] = useState<string | null>(null)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        setPlanName(res?.plan?.name ?? 'Free')
        setStripeEnabled(Boolean(res?.stripeEnabled))
      } catch {
        // Pricing is public; an unauthenticated visitor simply sees the static plan.
        setPlanName(null)
      }
    })()
  }, [])

  const upgrade = async () => {
    setBusy(true)
    setNote('')
    try {
      const res = await api.startCheckout()
      if (res?.url) {
        window.location.href = res.url
        return
      }
      setNote('Checkout is not configured. Every feature is already free.')
    } catch {
      setNote('Checkout is not configured. Every feature is already free.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="h-2.5 w-2.5 rounded-sm bg-yellow-400" />
          RohsReachSubstanceDeclarationLedger
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-yellow-400"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple pricing</h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-400">
          Every capability of the substance ledger is free while we are in beta. No part limits, no feature gates.
        </p>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-yellow-600/40 bg-slate-900/60 p-8 text-left shadow-xl">
          <div className="flex items-center justify-between">
            <span className="rounded-full border border-yellow-600/40 bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-300">
              Free plan
            </span>
            {planName && (
              <span className="text-xs text-slate-500">
                Current plan: <span className="text-slate-300">{planName}</span>
              </span>
            )}
          </div>
          <div className="mt-6 flex items-end gap-1">
            <span className="text-5xl font-black text-slate-100">$0</span>
            <span className="mb-1 text-slate-500">/ month</span>
          </div>
          <p className="mt-2 text-sm text-slate-400">All features, every regulatory list, no usage caps.</p>

          <ul className="mt-6 space-y-2.5">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="mt-0.5 text-yellow-400">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/auth/sign-up"
            className="mt-8 block w-full rounded-lg bg-yellow-500 py-3 text-center font-semibold text-slate-950 transition-colors hover:bg-yellow-400"
          >
            Get started free
          </Link>

          {stripeEnabled && (
            <button
              onClick={upgrade}
              disabled={busy}
              className="mt-3 block w-full rounded-lg border border-slate-700 bg-slate-800 py-3 text-center font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? 'Redirecting...' : 'Upgrade'}
            </button>
          )}

          {note && <p className="mt-3 text-center text-xs text-slate-500">{note}</p>}
        </div>

        <p className="mt-10 text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/auth/sign-in" className="text-yellow-400 hover:text-yellow-300">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  )
}
