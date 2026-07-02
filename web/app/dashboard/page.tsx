'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api, { getActiveWorkspaceId } from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Counts {
  compliant?: number
  'non-compliant'?: number
  'non_compliant'?: number
  'at-risk'?: number
  at_risk?: number
  incomplete?: number
  [k: string]: number | undefined
}
interface TrendPoint {
  label?: string
  date?: string
  coverage_pct?: number
  coveragePct?: number
  value?: number
}
interface SvhcExposurePoint {
  substance?: string
  substance_name?: string
  cas_number?: string
  products?: number
  product_count?: number
  count?: number
}
interface ExemptionRunwayPoint {
  exemption_number?: string
  description?: string
  expiry_date?: string
  days_remaining?: number
  daysRemaining?: number
}
interface SupplierResponsiveness {
  supplier?: string
  name?: string
  responsiveness_score?: number
  responsivenessScore?: number
  coverage_pct?: number
}
interface Overview {
  counts?: Counts
  coverageTrend?: TrendPoint[]
  coverage_trend?: TrendPoint[]
  // Backend returns these as objects: { affectedSubstances, items } and
  // { buckets, items } respectively — NOT bare arrays. See dashboard.ts.
  svhcExposure?: { affectedSubstances?: number; items?: SvhcExposurePoint[] }
  svhc_exposure?: { affectedSubstances?: number; items?: SvhcExposurePoint[] }
  exemptionRunway?: { buckets?: Record<string, number>; items?: ExemptionRunwayPoint[] }
  exemption_runway?: { buckets?: Record<string, number>; items?: ExemptionRunwayPoint[] }
  supplierResponsiveness?: SupplierResponsiveness[]
  supplier_responsiveness?: SupplierResponsiveness[]
}
interface Product {
  id: string
  name: string
  sku?: string
  part_number?: string
  category?: string
  market_region?: string
  compliance_status?: string
  updated_at?: string
}

const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)

function normTrend(o: Overview): { label: string; pct: number }[] {
  const raw = o.coverageTrend ?? o.coverage_trend ?? []
  return raw.map((p, i) => ({
    label: p.label ?? p.date ?? `T${i + 1}`,
    pct: Math.max(0, Math.min(100, num(p.coverage_pct ?? p.coveragePct ?? p.value))),
  }))
}

export default function DashboardOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const wsId = await getActiveWorkspaceId()
      if (!wsId) {
        setNoWorkspace(true)
        return
      }
      const [ov, prods] = await Promise.all([api.getOverview(wsId), api.listProducts({ workspace_id: wsId })])
      setOverview(ov ?? {})
      setProducts(Array.isArray(prods) ? prods : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const counts = overview?.counts ?? {}
  const compliant = num(counts.compliant)
  const nonCompliant = num(counts['non-compliant'] ?? counts['non_compliant'])
  const atRisk = num(counts['at-risk'] ?? counts.at_risk)
  const incomplete = num(counts.incomplete ?? counts['incomplete-data'])
  const totalCounted = compliant + nonCompliant + atRisk + incomplete

  const trend = useMemo(() => (overview ? normTrend(overview) : []), [overview])
  const latestCoverage = trend.length ? trend[trend.length - 1].pct : 0

  const svhc = (overview?.svhcExposure ?? overview?.svhc_exposure)?.items ?? []
  const runway = (overview?.exemptionRunway ?? overview?.exemption_runway)?.items ?? []
  const suppliers = overview?.supplierResponsiveness ?? overview?.supplier_responsiveness ?? []

  const recentProducts = useMemo(
    () =>
      [...products]
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
        .slice(0, 8),
    [products],
  )

  if (loading) return <PageSpinner label="Loading portfolio overview..." />

  if (noWorkspace) {
    return (
      <div className="space-y-4">
        <Header />
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings to start tracking products, suppliers, and declarations."
          action={
            <Link href="/dashboard/settings">
              <Button variant="secondary">Go to Settings</Button>
            </Link>
          }
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Header />
        <EmptyState
          title="Could not load the dashboard"
          description={error}
          action={
            <Button onClick={load} variant="secondary">
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const maxSvhc = Math.max(1, ...svhc.map((s) => num(s.products ?? s.product_count ?? s.count)))
  const maxTrend = Math.max(1, ...trend.map((t) => t.pct))

  return (
    <div className="space-y-6">
      <Header onRefresh={load} />

      {/* Status counts */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Compliant" value={compliant} tone="success" hint={`of ${totalCounted} products`} />
        <Stat label="Non-compliant" value={nonCompliant} tone="danger" hint="failing thresholds" />
        <Stat label="At risk" value={atRisk} tone="warning" hint="needs attention" />
        <Stat label="Incomplete data" value={incomplete} tone="default" hint="missing declarations" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Coverage trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Declaration coverage trend</h2>
              <p className="text-xs text-slate-500">Percentage of BOM mass with valid declarations over time</p>
            </div>
            <span className="text-2xl font-bold text-lime-400">{latestCoverage.toFixed(0)}%</span>
          </CardHeader>
          <CardBody>
            {trend.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-600">No coverage history yet.</p>
            ) : (
              <div className="flex h-44 items-end gap-2">
                {trend.map((t, i) => (
                  <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                      {t.pct.toFixed(0)}%
                    </span>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-lime-600/40 to-lime-400 transition-all"
                      style={{ height: `${Math.max(4, (t.pct / maxTrend) * 100)}%` }}
                      title={`${t.label}: ${t.pct.toFixed(1)}%`}
                    />
                    <span className="truncate text-[10px] text-slate-600">{t.label}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Exemption runway */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-100">Exemption runway</h2>
            <p className="text-xs text-slate-500">Soonest-expiring RoHS exemptions in use</p>
          </CardHeader>
          <CardBody>
            {runway.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-600">No exemptions expiring soon.</p>
            ) : (
              <ul className="space-y-3">
                {runway.slice(0, 6).map((r, i) => {
                  const days = num(r.days_remaining ?? r.daysRemaining)
                  const tone = days <= 30 ? 'danger' : days <= 90 ? 'warning' : 'lime'
                  return (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-200">
                          {r.exemption_number ?? 'Exemption'}
                        </div>
                        <div className="truncate text-xs text-slate-500">{r.description ?? r.expiry_date}</div>
                      </div>
                      <Badge tone={tone}>{days}d</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* SVHC exposure */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">SVHC exposure</h2>
              <p className="text-xs text-slate-500">Products affected per candidate-list substance</p>
            </div>
            <Link href="/dashboard/svhc" className="text-xs font-medium text-lime-400 hover:text-lime-300">
              SVHC watch →
            </Link>
          </CardHeader>
          <CardBody>
            {svhc.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-600">No SVHC exposure detected.</p>
            ) : (
              <ul className="space-y-2.5">
                {svhc.slice(0, 8).map((s, i) => {
                  const n = num(s.products ?? s.product_count ?? s.count)
                  return (
                    <li key={i}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate text-slate-300">{s.substance ?? s.substance_name ?? s.cas_number}</span>
                        <span className="ml-2 font-medium text-amber-300">{n}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                        <div
                          className="h-1.5 rounded-full bg-amber-400"
                          style={{ width: `${(n / maxSvhc) * 100}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Supplier responsiveness */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Supplier responsiveness</h2>
              <p className="text-xs text-slate-500">Declaration return performance</p>
            </div>
            <Link href="/dashboard/suppliers" className="text-xs font-medium text-lime-400 hover:text-lime-300">
              Suppliers →
            </Link>
          </CardHeader>
          <CardBody>
            {suppliers.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-600">No supplier data yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {suppliers.slice(0, 8).map((s, i) => {
                  const score = Math.max(0, Math.min(100, num(s.responsiveness_score ?? s.responsivenessScore)))
                  const tone = score >= 70 ? 'bg-lime-400' : score >= 40 ? 'bg-amber-400' : 'bg-red-400'
                  return (
                    <li key={i}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate text-slate-300">{s.supplier ?? s.name ?? 'Supplier'}</span>
                        <span className="ml-2 font-medium text-slate-200">{score.toFixed(0)}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${score}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Recent products */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Recent products</h2>
          <Link href="/dashboard/products" className="text-xs font-medium text-lime-400 hover:text-lime-300">
            All products →
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          {recentProducts.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No products yet"
              description="Create your first product to start building a compliance ledger."
              action={
                <Link href="/dashboard/products">
                  <Button>Add product</Button>
                </Link>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH>Region</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {recentProducts.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/dashboard/products/${p.id}`} className="font-medium text-slate-100 hover:text-lime-300">
                        {p.name}
                      </Link>
                      {p.part_number && <span className="ml-2 text-xs text-slate-600">{p.part_number}</span>}
                    </TD>
                    <TD className="text-slate-400">{p.sku ?? '—'}</TD>
                    <TD className="text-slate-400">{p.market_region ?? '—'}</TD>
                    <TD>
                      <Badge tone={statusTone(p.compliance_status)}>{p.compliance_status ?? 'unknown'}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Header({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-100">Portfolio overview</h1>
        <p className="text-sm text-slate-500">RoHS &amp; REACH compliance posture across your product portfolio</p>
      </div>
      {onRefresh && (
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      )}
    </div>
  )
}
