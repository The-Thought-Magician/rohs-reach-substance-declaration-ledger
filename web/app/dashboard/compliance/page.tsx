'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface ComplianceResult {
  id: string
  workspace_id?: string
  product_id?: string
  product_name?: string
  product_sku?: string
  rohs_verdict?: string
  reach_verdict?: string
  overall_verdict?: string
  offending_component_id?: string | null
  offending_substance?: string | null
  coverage_pct?: number | null
  details?: unknown
  computed_at?: string | null
  created_at?: string
}

interface Product {
  id: string
  name?: string
  sku?: string
}

function fmtDate(date?: string | null): string {
  if (!date) return 'never'
  const d = new Date(date)
  if (isNaN(d.getTime())) return 'never'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function verdictTone(v?: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  switch ((v ?? '').toLowerCase()) {
    case 'compliant':
    case 'pass':
      return 'success'
    case 'non-compliant':
    case 'non_compliant':
    case 'fail':
      return 'danger'
    case 'at-risk':
    case 'at_risk':
      return 'warning'
    case 'incomplete':
    case 'incomplete-data':
    case 'incomplete_data':
      return 'info'
    default:
      return 'neutral'
  }
}

export default function CompliancePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ComplianceResult[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)

  const [search, setSearch] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<string>('all')
  const [recomputing, setRecomputing] = useState(false)
  const [computingId, setComputingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ComplianceResult | null>(null)

  async function load() {
    setError(null)
    try {
      let wsId: string | undefined
      try {
        const ws = await api.listWorkspaces()
        if (Array.isArray(ws) && ws.length > 0) wsId = ws[0].id
      } catch {
        /* best-effort */
      }
      setWorkspaceId(wsId)
      const [res, prods] = await Promise.all([
        api.listComplianceResults(wsId),
        api.listProducts(wsId ? { workspace_id: wsId } : undefined),
      ])
      setResults(Array.isArray(res) ? res : [])
      setProducts(Array.isArray(prods) ? prods : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load compliance results')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const productName = (r: ComplianceResult) => {
    if (r.product_name) return r.product_name
    const p = products.find((x) => x.id === r.product_id)
    return p ? p.name || p.sku || p.id : r.product_id || '—'
  }

  async function recomputeAll() {
    if (!confirm('Recompute the threshold engine for every product in the workspace?')) return
    setRecomputing(true)
    setError(null)
    try {
      await api.recomputeAll(workspaceId ? { workspace_id: workspaceId } : {})
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  async function recomputeOne(productId?: string) {
    if (!productId) return
    setComputingId(productId)
    setError(null)
    try {
      await api.computeCompliance(productId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compute failed')
    } finally {
      setComputingId(null)
    }
  }

  const stats = useMemo(() => {
    let compliant = 0
    let nonCompliant = 0
    let atRisk = 0
    let incomplete = 0
    let covSum = 0
    let covN = 0
    for (const r of results) {
      const t = verdictTone(r.overall_verdict)
      if (t === 'success') compliant++
      else if (t === 'danger') nonCompliant++
      else if (t === 'warning') atRisk++
      else if (t === 'info') incomplete++
      if (typeof r.coverage_pct === 'number') {
        covSum += r.coverage_pct
        covN++
      }
    }
    return {
      total: results.length,
      compliant,
      nonCompliant,
      atRisk,
      incomplete,
      avgCoverage: covN ? Math.round(covSum / covN) : 0,
    }
  }, [results])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return results.filter((r) => {
      if (verdictFilter !== 'all' && verdictTone(r.overall_verdict) !== verdictFilter) return false
      if (!q) return true
      return [productName(r), r.offending_substance, r.rohs_verdict, r.reach_verdict]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, search, verdictFilter, products])

  if (loading) return <PageSpinner label="Loading compliance engine…" />

  const filterTabs: { key: string; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'success', label: 'Compliant' },
    { key: 'danger', label: 'Non-compliant' },
    { key: 'warning', label: 'At risk' },
    { key: 'info', label: 'Incomplete' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Compliance Engine</h1>
          <p className="mt-1 text-sm text-slate-500">
            Deterministic RoHS &amp; REACH threshold results per product, with offending part and substance.
          </p>
        </div>
        <Button onClick={recomputeAll} disabled={recomputing}>
          {recomputing ? <Spinner label="Recomputing…" /> : 'Recompute all'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Products scored" value={stats.total} tone="lime" />
        <Stat label="Compliant" value={stats.compliant} tone="success" />
        <Stat label="Non-compliant" value={stats.nonCompliant} tone={stats.nonCompliant > 0 ? 'danger' : 'default'} />
        <Stat label="At risk / incomplete" value={stats.atRisk + stats.incomplete} tone="warning" />
        <Stat label="Avg coverage" value={`${stats.avgCoverage}%`} />
      </div>

      {/* Portfolio verdict bar */}
      {stats.total > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Portfolio verdict mix</h2>
          </CardHeader>
          <CardBody>
            <div className="flex h-6 w-full overflow-hidden rounded-lg bg-slate-800">
              {[
                { n: stats.compliant, c: 'bg-emerald-500/70', label: 'Compliant' },
                { n: stats.atRisk, c: 'bg-amber-400/70', label: 'At risk' },
                { n: stats.incomplete, c: 'bg-sky-500/70', label: 'Incomplete' },
                { n: stats.nonCompliant, c: 'bg-red-500/70', label: 'Non-compliant' },
              ]
                .filter((s) => s.n > 0)
                .map((s) => (
                  <div
                    key={s.label}
                    className={`${s.c} flex items-center justify-center text-[10px] font-semibold text-slate-950`}
                    style={{ width: `${(s.n / stats.total) * 100}%` }}
                    title={`${s.label}: ${s.n}`}
                  >
                    {((s.n / stats.total) * 100) >= 8 ? s.n : ''}
                  </div>
                ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {filterTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setVerdictFilter(t.key)}
                className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                  verdictFilter === t.key
                    ? 'border-yellow-600/50 bg-yellow-500/15 text-yellow-300'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, substance…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-yellow-500/60 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={results.length === 0 ? 'No compliance results yet' : 'No matches'}
                description={
                  results.length === 0
                    ? 'Run the threshold engine to score your products against RoHS and REACH limits.'
                    : 'Adjust the filter or search term.'
                }
                action={
                  results.length === 0 ? (
                    <Button onClick={recomputeAll} disabled={recomputing}>
                      {recomputing ? <Spinner label="Recomputing…" /> : 'Recompute all'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Overall</TH>
                  <TH>RoHS</TH>
                  <TH>REACH</TH>
                  <TH>Offending substance</TH>
                  <TH>Coverage</TH>
                  <TH>Computed</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-slate-200">{productName(r)}</TD>
                    <TD>
                      <Badge tone={verdictTone(r.overall_verdict)}>{r.overall_verdict || 'unknown'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={verdictTone(r.rohs_verdict)}>{r.rohs_verdict || '—'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={verdictTone(r.reach_verdict)}>{r.reach_verdict || '—'}</Badge>
                    </TD>
                    <TD className="text-slate-300">{r.offending_substance || <span className="text-slate-600">—</span>}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded bg-slate-800">
                          <div
                            className={`h-full ${
                              (r.coverage_pct ?? 0) >= 90
                                ? 'bg-yellow-500/70'
                                : (r.coverage_pct ?? 0) >= 50
                                  ? 'bg-amber-400/70'
                                  : 'bg-red-500/70'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, r.coverage_pct ?? 0))}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{Math.round(r.coverage_pct ?? 0)}%</span>
                      </div>
                    </TD>
                    <TD className="text-xs text-slate-500">{fmtDate(r.computed_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                          Details
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => recomputeOne(r.product_id)}
                          disabled={computingId === r.product_id}
                        >
                          {computingId === r.product_id ? 'Computing…' : 'Recompute'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Compliance result detail" className="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Product" value={productName(detail)} />
              <Info label="Computed" value={fmtDate(detail.computed_at)} />
              <Info label="Overall" value={<Badge tone={verdictTone(detail.overall_verdict)}>{detail.overall_verdict || '—'}</Badge>} />
              <Info label="Coverage" value={`${Math.round(detail.coverage_pct ?? 0)}%`} />
              <Info label="RoHS" value={<Badge tone={verdictTone(detail.rohs_verdict)}>{detail.rohs_verdict || '—'}</Badge>} />
              <Info label="REACH" value={<Badge tone={verdictTone(detail.reach_verdict)}>{detail.reach_verdict || '—'}</Badge>} />
              <Info label="Offending substance" value={detail.offending_substance || '—'} />
              <Info label="Offending component" value={detail.offending_component_id || '—'} />
            </div>
            {detail.details != null && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Engine details</div>
                <pre className="max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
                  {JSON.stringify(detail.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-slate-200">{value}</div>
    </div>
  )
}
