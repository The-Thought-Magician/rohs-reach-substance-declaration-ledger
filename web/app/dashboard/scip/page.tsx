'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface SummaryProduct {
  product_id?: string
  id?: string
  product_name?: string
  name?: string
  sku?: string
  required?: boolean
  articleCount?: number
  article_count?: number
}

interface ScipSummary {
  products?: SummaryProduct[]
}

interface ScipArticle {
  component?: string
  component_name?: string
  substance?: string
  substance_name?: string
  cas_number?: string
  concentration_ppm?: number
  location?: string
}

interface ScipProductResp {
  product?: { id?: string; name?: string; sku?: string }
  articles?: ScipArticle[]
  required?: boolean
}

function pid(p: SummaryProduct): string {
  return (p.product_id || p.id || '') as string
}
function pname(p: SummaryProduct): string {
  return p.product_name || p.name || pid(p) || '—'
}
function acount(p: SummaryProduct): number {
  return p.articleCount ?? p.article_count ?? 0
}
function ppmPct(ppm?: number): string {
  if (typeof ppm !== 'number') return '—'
  return `${(ppm / 10000).toFixed(3)}%`
}

export default function ScipPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ScipSummary>({})
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [onlyRequired, setOnlyRequired] = useState(false)

  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ScipProductResp | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

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
      const sum = await api.getScipSummary(wsId)
      setSummary(sum && typeof sum === 'object' ? sum : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SCIP summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openProduct(productId: string) {
    setSelected(productId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const d = await api.getScipProduct(productId)
      setDetail(d && typeof d === 'object' ? d : {})
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load product articles')
    } finally {
      setDetailLoading(false)
    }
  }

  const products = summary.products ?? []

  const stats = useMemo(() => {
    const total = products.length
    const required = products.filter((p) => p.required).length
    const articles = products.reduce((s, p) => s + acount(p), 0)
    return { total, required, ready: total - required, articles }
  }, [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (onlyRequired && !p.required) return false
      if (!q) return true
      return [pname(p), p.sku].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    })
  }, [products, search, onlyRequired])

  if (loading) return <PageSpinner label="Loading SCIP readiness…" />

  const selectedProduct = products.find((p) => pid(p) === selected)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">SCIP Readiness</h1>
          <p className="mt-1 text-sm text-slate-500">
            ECHA SCIP notification readiness. Articles containing an SVHC above 0.1% (w/w) must be notified.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Products" value={stats.total} tone="lime" />
        <Stat label="Notification required" value={stats.required} tone={stats.required > 0 ? 'danger' : 'default'} />
        <Stat label="No notification needed" value={stats.ready} tone="success" />
        <Stat label="Notifiable articles" value={stats.articles} tone="warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Product list */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">Products</h2>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={onlyRequired}
                onChange={(e) => setOnlyRequired(e.target.checked)}
                className="accent-lime-500"
              />
              Required only
            </label>
          </CardHeader>
          <CardBody className="space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500/60 focus:outline-none"
            />
            {filtered.length === 0 ? (
              <EmptyState
                title={products.length === 0 ? 'No products' : 'No matches'}
                description={
                  products.length === 0
                    ? 'Add products with BOMs and SVHC data to assess SCIP readiness.'
                    : 'Adjust the filter or search term.'
                }
              />
            ) : (
              <div className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
                {filtered.map((p) => {
                  const id = pid(p)
                  const active = id === selected
                  return (
                    <button
                      key={id}
                      onClick={() => openProduct(id)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        active ? 'bg-lime-500/10' : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-200">{pname(p)}</div>
                        {p.sku && <div className="truncate text-xs text-slate-500">{p.sku}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={p.required ? 'danger' : 'success'}>
                          {p.required ? 'Notify' : 'Clear'}
                        </Badge>
                        <Badge tone={acount(p) > 0 ? 'warning' : 'neutral'}>{acount(p)}</Badge>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Article detail */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              {selectedProduct ? `Articles — ${pname(selectedProduct)}` : 'Notifiable articles'}
            </h2>
            {detail && (
              <Badge tone={detail.required ? 'danger' : 'success'}>
                {detail.required ? 'Notification required' : 'No notification required'}
              </Badge>
            )}
          </CardHeader>
          <CardBody>
            {!selected ? (
              <EmptyState
                title="Select a product"
                description="Choose a product on the left to see the articles and SVHCs requiring a SCIP notification."
              />
            ) : detailLoading ? (
              <div className="py-10 text-center">
                <Spinner label="Loading articles…" />
              </div>
            ) : detailError ? (
              <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {detailError}
              </div>
            ) : !detail || (detail.articles ?? []).length === 0 ? (
              <EmptyState
                title="No notifiable articles"
                description="No article in this product contains an SVHC above the 0.1% (w/w) threshold."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Article / component</TH>
                    <TH>Substance</TH>
                    <TH>CAS</TH>
                    <TH>Concentration</TH>
                    <TH>Location</TH>
                  </TR>
                </THead>
                <TBody>
                  {(detail.articles ?? []).map((a, i) => (
                    <TR key={i}>
                      <TD className="font-medium text-slate-200">{a.component || a.component_name || '—'}</TD>
                      <TD className="text-slate-300">{a.substance || a.substance_name || '—'}</TD>
                      <TD className="font-mono text-xs text-slate-400">{a.cas_number || '—'}</TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          <Badge tone="warning">{ppmPct(a.concentration_ppm)}</Badge>
                          <span className="text-xs text-slate-500">
                            {typeof a.concentration_ppm === 'number' ? `${a.concentration_ppm} ppm` : ''}
                          </span>
                        </span>
                      </TD>
                      <TD className="text-slate-400">{a.location || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
