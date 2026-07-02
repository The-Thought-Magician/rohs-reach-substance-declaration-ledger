'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ProductHit {
  id: string
  name?: string
  sku?: string
  part_number?: string
  compliance_status?: string
  category?: string
}
interface ComponentHit {
  id: string
  name?: string
  manufacturer_part_number?: string
  manufacturer?: string
}
interface SupplierHit {
  id: string
  name?: string
  region?: string
}
interface SubstanceHit {
  id?: string
  name?: string
  substance_name?: string
  cas_number?: string
}
interface SearchResult {
  products?: ProductHit[]
  components?: ComponentHit[]
  suppliers?: SupplierHit[]
  substances?: SubstanceHit[]
}

interface LookupHit {
  product?: ProductHit
  component?: ComponentHit
  material?: { id?: string; name?: string }
  concentration_ppm?: number
}
interface LookupResult {
  cas?: string
  hits?: LookupHit[]
}

type Tab = 'global' | 'cas'

const CAS_RE = /^\d{2,7}-\d{2}-\d$/

function ppmToPct(ppm?: number): string {
  if (ppm === undefined || ppm === null) return '—'
  return `${(ppm / 10000).toFixed(4)}%`
}

export default function SearchPage() {
  const [tab, setTab] = useState<Tab>('global')
  const [workspaceId, setWorkspaceId] = useState<string>('')

  useEffect(() => {
    ;(async () => {
      try {
        const ws = await api.listWorkspaces()
        setWorkspaceId(Array.isArray(ws) && ws.length ? ws[0].id : '')
      } catch {
        setWorkspaceId('')
      }
    })()
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Search</h1>
        <p className="mt-1 text-sm text-slate-500">
          Find any product, part, supplier, or substance — or reverse-trace a CAS number to every part that contains
          it.
        </p>
      </div>

      <div className="mb-6 inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        <button
          onClick={() => setTab('global')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === 'global' ? 'bg-yellow-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          Global Search
        </button>
        <button
          onClick={() => setTab('cas')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === 'cas' ? 'bg-yellow-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          CAS Reverse Lookup
        </button>
      </div>

      {tab === 'global' ? (
        <GlobalSearch workspaceId={workspaceId} />
      ) : (
        <CasLookup workspaceId={workspaceId} />
      )}
    </div>
  )
}

function GlobalSearch({ workspaceId }: { workspaceId: string }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [searched, setSearched] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(
    async (term: string) => {
      const t = term.trim()
      if (t.length < 2) {
        setResult(null)
        setSearched(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const r = await api.search(t, workspaceId || undefined)
        setResult(r ?? {})
        setSearched(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    [workspaceId],
  )

  const onChange = (v: string) => {
    setQ(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => run(v), 350)
  }

  const products = result?.products ?? []
  const components = result?.components ?? []
  const suppliers = result?.suppliers ?? []
  const substances = result?.substances ?? []
  const total = products.length + components.length + suppliers.length + substances.length

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(q)
        }}
        className="mb-5 flex gap-2"
      >
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search products, components, suppliers, substances..."
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-yellow-500 focus:outline-none"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner /> : 'Search'}
        </Button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!searched && !loading && (
        <EmptyState
          title="Start typing to search"
          description="Enter at least 2 characters. Results stream across products, components, suppliers, and substances."
          icon="🔎"
        />
      )}

      {searched && !loading && total === 0 && (
        <EmptyState title="No matches" description={`Nothing matched “${q}”.`} icon="🫥" />
      )}

      {searched && total > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Products" value={products.length} tone="lime" />
            <Stat label="Components" value={components.length} />
            <Stat label="Suppliers" value={suppliers.length} />
            <Stat label="Substances" value={substances.length} tone="warning" />
          </div>

          {products.length > 0 && (
            <ResultSection title="Products" count={products.length}>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>SKU / Part</TH>
                    <TH>Status</TH>
                    <TH className="text-right" />
                  </TR>
                </THead>
                <TBody>
                  {products.map((p) => (
                    <TR key={p.id}>
                      <TD className="font-medium text-slate-100">{p.name ?? '—'}</TD>
                      <TD className="font-mono text-xs text-slate-400">{p.sku ?? p.part_number ?? '—'}</TD>
                      <TD>
                        {p.compliance_status ? (
                          <Badge tone={statusTone(p.compliance_status)}>{p.compliance_status}</Badge>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="text-right">
                        <Link href={`/dashboard/products/${p.id}`} className="text-xs text-yellow-400 hover:underline">
                          Open →
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </ResultSection>
          )}

          {components.length > 0 && (
            <ResultSection title="Components" count={components.length}>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>MPN</TH>
                    <TH>Manufacturer</TH>
                    <TH className="text-right" />
                  </TR>
                </THead>
                <TBody>
                  {components.map((c) => (
                    <TR key={c.id}>
                      <TD className="font-medium text-slate-100">{c.name ?? '—'}</TD>
                      <TD className="font-mono text-xs text-slate-400">{c.manufacturer_part_number ?? '—'}</TD>
                      <TD className="text-slate-400">{c.manufacturer ?? '—'}</TD>
                      <TD className="text-right">
                        <Link
                          href={`/dashboard/components/${c.id}`}
                          className="text-xs text-yellow-400 hover:underline"
                        >
                          Open →
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </ResultSection>
          )}

          {suppliers.length > 0 && (
            <ResultSection title="Suppliers" count={suppliers.length}>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Region</TH>
                    <TH className="text-right" />
                  </TR>
                </THead>
                <TBody>
                  {suppliers.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-medium text-slate-100">{s.name ?? '—'}</TD>
                      <TD className="text-slate-400">{s.region ?? '—'}</TD>
                      <TD className="text-right">
                        <Link
                          href={`/dashboard/suppliers/${s.id}`}
                          className="text-xs text-yellow-400 hover:underline"
                        >
                          Open →
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </ResultSection>
          )}

          {substances.length > 0 && (
            <ResultSection title="Substances" count={substances.length}>
              <Table>
                <THead>
                  <TR>
                    <TH>Substance</TH>
                    <TH>CAS</TH>
                    <TH className="text-right" />
                  </TR>
                </THead>
                <TBody>
                  {substances.map((s, i) => {
                    const name = s.name ?? s.substance_name ?? '—'
                    return (
                      <TR key={s.id ?? `${s.cas_number}-${i}`}>
                        <TD className="font-medium text-slate-100">{name}</TD>
                        <TD className="font-mono text-xs text-amber-300">{s.cas_number ?? '—'}</TD>
                        <TD className="text-right" />
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </ResultSection>
          )}
        </div>
      )}
    </div>
  )
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <Badge tone="neutral">{count}</Badge>
      </div>
      {children}
    </div>
  )
}

function CasLookup({ workspaceId }: { workspaceId: string }) {
  const [cas, setCas] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [searched, setSearched] = useState(false)

  const valid = CAS_RE.test(cas.trim())

  const run = async () => {
    const c = cas.trim()
    if (!c) return
    setLoading(true)
    setError(null)
    try {
      const r = await api.substanceLookup(c, workspaceId || undefined)
      setResult(r ?? { cas: c, hits: [] })
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const hits = result?.hits ?? []
  const distinctProducts = new Set(hits.map((h) => h.product?.id).filter(Boolean)).size
  const distinctComponents = new Set(hits.map((h) => h.component?.id).filter(Boolean)).size
  const maxPpm = hits.reduce((m, h) => Math.max(m, h.concentration_ppm ?? 0), 0)

  return (
    <div>
      <Card className="mb-5">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Reverse CAS Lookup</h2>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-xs text-slate-500">
            Enter a CAS Registry Number (e.g. <span className="font-mono text-amber-300">7439-92-1</span> for lead) to
            trace every product, part, and homogeneous material that declares it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              run()
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              value={cas}
              onChange={(e) => setCas(e.target.value)}
              placeholder="e.g. 7439-92-1"
              className="w-56 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-yellow-500 focus:outline-none"
            />
            <Button type="submit" disabled={loading || !cas.trim()}>
              {loading ? <Spinner /> : 'Trace'}
            </Button>
          </form>
          {cas.trim() && !valid && (
            <p className="mt-2 text-xs text-amber-400">
              That does not look like a standard CAS format (NNNNNNN-NN-N). Tracing anyway on submit.
            </p>
          )}
        </CardBody>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!searched && !loading && (
        <EmptyState
          title="Trace a substance"
          description="Enter a CAS number above to find where it appears across your BOMs."
          icon="🧪"
        />
      )}

      {searched && !loading && hits.length === 0 && (
        <EmptyState
          title="Not found in any part"
          description={`No declared material contains CAS ${result?.cas ?? cas}. That is good news for compliance.`}
          icon="✅"
        />
      )}

      {searched && hits.length > 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total Occurrences" value={hits.length} tone="danger" />
            <Stat label="Affected Products" value={distinctProducts} tone="warning" />
            <Stat label="Affected Components" value={distinctComponents} />
            <Stat label="Max Concentration" value={ppmToPct(maxPpm)} hint={`${maxPpm} ppm`} />
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-200">
                Occurrences of <span className="font-mono text-amber-300">{result?.cas ?? cas}</span>
              </h3>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Component</TH>
                  <TH>Material</TH>
                  <TH className="text-right">Concentration</TH>
                  <TH className="text-right">vs 0.1%</TH>
                </TR>
              </THead>
              <TBody>
                {hits.map((h, i) => {
                  const ppm = h.concentration_ppm ?? 0
                  const over = ppm > 1000
                  return (
                    <TR key={i}>
                      <TD>
                        {h.product?.id ? (
                          <Link
                            href={`/dashboard/products/${h.product.id}`}
                            className="font-medium text-slate-100 hover:text-yellow-300"
                          >
                            {h.product.name ?? h.product.id}
                          </Link>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TD>
                      <TD>
                        {h.component?.id ? (
                          <Link
                            href={`/dashboard/components/${h.component.id}`}
                            className="text-slate-300 hover:text-yellow-300"
                          >
                            {h.component.name ?? h.component.id}
                          </Link>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TD>
                      <TD className="text-slate-400">{h.material?.name ?? '—'}</TD>
                      <TD className="text-right font-mono text-slate-200">
                        {ppm} ppm
                        <span className="ml-1 text-xs text-slate-500">({ppmToPct(ppm)})</span>
                      </TD>
                      <TD className="text-right">
                        <Badge tone={over ? 'danger' : 'success'}>{over ? 'Over' : 'Under'}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            <p className="mt-2 text-xs text-slate-600">
              The 0.1% (1000 ppm) line is the REACH SVHC article-notification threshold.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
