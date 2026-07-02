'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api, { getActiveWorkspaceId } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Product {
  id: string
  name: string
  sku?: string | null
  part_number?: string | null
  category?: string | null
  market_region?: string | null
  compliance_status?: string | null
  lifecycle_status?: string | null
}

interface PackBomItem {
  id?: string
  reference?: string | null
  quantity?: number | null
  mass_grams?: number | null
  component?: { id?: string; name?: string; manufacturer_part_number?: string | null } | null
  name?: string | null
}

interface PackDeclaration {
  id: string
  format?: string | null
  status?: string | null
  document_url?: string | null
  valid_until?: string | null
  confidence?: string | number | null
  component?: { name?: string } | null
  supplier?: { name?: string } | null
}

interface PackExemption {
  id: string
  exemption_number?: string | null
  description?: string | null
  justification?: string | null
  expiry_date?: string | null
}

interface PackVerdict {
  overall_verdict?: string | null
  rohs_verdict?: string | null
  reach_verdict?: string | null
  coverage_pct?: number | null
  offending_substance?: string | null
}

interface Pack {
  product?: Product
  bom?: PackBomItem[] | { version?: unknown; items?: PackBomItem[] }
  declarations?: PackDeclaration[]
  verdict?: PackVerdict | null
  exemptions?: PackExemption[]
  certificate?: Record<string, unknown> | null
}

interface ExportResult {
  report?: { id?: string; title?: string; created_at?: string }
  pack?: Pack
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString()
}

function verdictTone(v?: string | null): 'success' | 'danger' | 'warning' | 'neutral' {
  const s = (v ?? '').toLowerCase()
  if (s.includes('pass') || s === 'compliant') return 'success'
  if (s.includes('fail') || s.includes('non')) return 'danger'
  if (s.includes('risk') || s.includes('incomplete') || s.includes('pending')) return 'warning'
  return 'neutral'
}

export default function PacksPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pack, setPack] = useState<Pack | null>(null)
  const [loadingPack, setLoadingPack] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingProducts(true)
    getActiveWorkspaceId()
      .then((wsId) => {
        if (cancelled) return Promise.reject(new Error('__no_ws__'))
        if (!wsId) {
          setNoWorkspace(true)
          throw new Error('__no_ws__')
        }
        return api.listProducts({ workspace_id: wsId })
      })
      .then((rows: Product[]) => {
        if (cancelled) return
        const list = Array.isArray(rows) ? rows : []
        setProducts(list)
        if (list.length && !selectedId) setSelectedId(list[0].id)
      })
      .catch((e: Error) => {
        if (cancelled || e.message === '__no_ws__') return
        setError(e.message)
      })
      .finally(() => !cancelled && setLoadingProducts(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setPack(null)
      return
    }
    let cancelled = false
    setLoadingPack(true)
    setPackError(null)
    setExportMsg(null)
    api
      .getPack(selectedId)
      .then((p: Pack) => !cancelled && setPack(p ?? null))
      .catch((e: Error) => !cancelled && setPackError(e.message))
      .finally(() => !cancelled && setLoadingPack(false))
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.part_number?.toLowerCase().includes(q),
    )
  }, [products, query])

  async function handleExport() {
    if (!selectedId) return
    setExporting(true)
    setExportMsg(null)
    setPackError(null)
    try {
      const res: ExportResult = await api.exportPack(selectedId)
      if (res?.pack) setPack(res.pack)
      const title = res?.report?.title ?? 'Declaration pack'
      setExportMsg(`Exported "${title}". A report record was created in Reports.`)
      // Trigger a client-side JSON download of the assembled pack as evidence.
      const payload = res?.pack ?? pack
      if (payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `declaration-pack-${selectedId}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      setPackError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const verdict = pack?.verdict ?? null
  const bom = Array.isArray(pack?.bom) ? pack.bom : pack?.bom?.items ?? []
  const declarations = pack?.declarations ?? []
  const exemptions = pack?.exemptions ?? []

  const declarationCoverage = useMemo(() => {
    if (typeof verdict?.coverage_pct === 'number') return Math.round(verdict.coverage_pct)
    if (!bom.length) return 0
    const covered = declarations.filter((d) => (d.status ?? '').toLowerCase() !== 'rejected').length
    return Math.min(100, Math.round((covered / bom.length) * 100))
  }, [verdict, bom, declarations])

  if (noWorkspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-100">Declaration Packs</h1>
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings before assembling declaration packs."
          action={
            <Link href="/dashboard/settings">
              <Button variant="secondary">Go to Settings</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-100">Declaration Packs</h1>
        <p className="text-sm text-slate-500">
          Assemble a single conformity dossier per product — BOM, supplier declarations, exemptions and the computed
          RoHS/REACH verdict — then export it as evidence.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* Product picker */}
        <Card className="h-fit">
          <CardHeader className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">Products</span>
            <Badge tone="neutral">{products.length}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500/60 focus:outline-none"
            />
            {loadingProducts ? (
              <div className="py-6">
                <Spinner label="Loading products..." />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No products match.</p>
            ) : (
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                {filtered.map((p) => {
                  const active = p.id === selectedId
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setSelectedId(p.id)}
                        className={`flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                          active
                            ? 'border-lime-500/50 bg-lime-500/10'
                            : 'border-transparent hover:border-slate-700 hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-200">{p.name}</span>
                          <Badge tone={statusTone(p.compliance_status ?? undefined)}>
                            {p.compliance_status ?? 'unknown'}
                          </Badge>
                        </span>
                        <span className="mt-0.5 truncate text-xs text-slate-500">
                          {p.sku || p.part_number || p.category || '—'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Pack assembly */}
        <div className="space-y-6">
          {!selectedId ? (
            <EmptyState
              title="No product selected"
              description="Pick a product from the list to assemble its declaration pack."
              icon="📦"
            />
          ) : loadingPack ? (
            <PageSpinner label="Assembling pack..." />
          ) : packError ? (
            <Card>
              <CardBody>
                <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {packError}
                </div>
              </CardBody>
            </Card>
          ) : !pack ? (
            <EmptyState title="No pack data" description="This product has no assembled pack yet." icon="📦" />
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">{pack.product?.name ?? 'Pack'}</h2>
                  <p className="text-xs text-slate-500">
                    {pack.product?.sku ? `SKU ${pack.product.sku}` : ''}
                    {pack.product?.market_region ? ` · ${pack.product.market_region}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {exporting && <Spinner label="Exporting..." />}
                  <Button onClick={handleExport} disabled={exporting}>
                    Export pack
                  </Button>
                </div>
              </div>

              {exportMsg && (
                <div className="rounded-lg border border-lime-600/40 bg-lime-500/10 px-3 py-2 text-sm text-lime-300">
                  {exportMsg}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat
                  label="Overall verdict"
                  value={verdict?.overall_verdict ?? 'N/A'}
                  tone={
                    verdictTone(verdict?.overall_verdict) === 'success'
                      ? 'success'
                      : verdictTone(verdict?.overall_verdict) === 'danger'
                        ? 'danger'
                        : verdictTone(verdict?.overall_verdict) === 'warning'
                          ? 'warning'
                          : 'default'
                  }
                />
                <Stat label="Coverage" value={`${declarationCoverage}%`} tone="lime" hint={`${bom.length} BOM lines`} />
                <Stat label="Declarations" value={declarations.length} hint="on file" />
                <Stat label="Exemptions" value={exemptions.length} hint="applied" />
              </div>

              {/* Coverage bar */}
              <Card>
                <CardBody className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Declaration coverage</span>
                    <span>{declarationCoverage}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-lime-500 transition-all"
                      style={{ width: `${declarationCoverage}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 text-xs">
                    <span className="flex items-center gap-1 text-slate-400">
                      RoHS:{' '}
                      <Badge tone={verdictTone(verdict?.rohs_verdict)}>{verdict?.rohs_verdict ?? 'N/A'}</Badge>
                    </span>
                    <span className="flex items-center gap-1 text-slate-400">
                      REACH:{' '}
                      <Badge tone={verdictTone(verdict?.reach_verdict)}>{verdict?.reach_verdict ?? 'N/A'}</Badge>
                    </span>
                    {verdict?.offending_substance && (
                      <span className="flex items-center gap-1 text-slate-400">
                        Offending: <Badge tone="danger">{verdict.offending_substance}</Badge>
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>

              {/* BOM */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">Bill of materials</span>
                  <Badge tone="neutral">{bom.length}</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  {bom.length === 0 ? (
                    <p className="px-5 py-6 text-center text-sm text-slate-500">No BOM lines.</p>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Reference</TH>
                          <TH>Component</TH>
                          <TH>MPN</TH>
                          <TH className="text-right">Qty</TH>
                          <TH className="text-right">Mass (g)</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {bom.map((it, i) => (
                          <TR key={it.id ?? i}>
                            <TD className="text-slate-400">{it.reference ?? '—'}</TD>
                            <TD>{it.component?.name ?? it.name ?? '—'}</TD>
                            <TD className="text-slate-400">{it.component?.manufacturer_part_number ?? '—'}</TD>
                            <TD className="text-right">{it.quantity ?? '—'}</TD>
                            <TD className="text-right">{it.mass_grams ?? '—'}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>

              {/* Declarations */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">Supplier declarations</span>
                  <Badge tone="neutral">{declarations.length}</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  {declarations.length === 0 ? (
                    <p className="px-5 py-6 text-center text-sm text-slate-500">No declarations on file.</p>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Component</TH>
                          <TH>Supplier</TH>
                          <TH>Format</TH>
                          <TH>Status</TH>
                          <TH>Valid until</TH>
                          <TH>Document</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {declarations.map((d) => (
                          <TR key={d.id}>
                            <TD>{d.component?.name ?? '—'}</TD>
                            <TD className="text-slate-400">{d.supplier?.name ?? '—'}</TD>
                            <TD className="text-slate-400">{d.format ?? '—'}</TD>
                            <TD>
                              <Badge tone={statusTone(d.status ?? undefined)}>{d.status ?? 'unknown'}</Badge>
                            </TD>
                            <TD className="text-slate-400">{fmtDate(d.valid_until)}</TD>
                            <TD>
                              {d.document_url ? (
                                <a
                                  href={d.document_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-lime-400 hover:underline"
                                >
                                  View
                                </a>
                              ) : (
                                '—'
                              )}
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>

              {/* Exemptions */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">Applied exemptions</span>
                  <Badge tone="neutral">{exemptions.length}</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  {exemptions.length === 0 ? (
                    <p className="px-5 py-6 text-center text-sm text-slate-500">No exemptions applied.</p>
                  ) : (
                    <ul className="divide-y divide-slate-800">
                      {exemptions.map((ex) => (
                        <li key={ex.id} className="flex items-start justify-between gap-4 px-5 py-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge tone="lime">{ex.exemption_number ?? 'exemption'}</Badge>
                              <span className="text-sm text-slate-300">{ex.description ?? '—'}</span>
                            </div>
                            {ex.justification && (
                              <p className="mt-1 text-xs text-slate-500">{ex.justification}</p>
                            )}
                          </div>
                          <span className="whitespace-nowrap text-xs text-slate-500">
                            expires {fmtDate(ex.expiry_date)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
