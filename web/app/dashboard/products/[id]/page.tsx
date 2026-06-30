'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Product {
  id: string
  name: string
  sku?: string
  part_number?: string
  category?: string
  market_region?: string
  lifecycle_status?: string
  compliance_status?: string
}
interface Offending {
  component?: string
  component_name?: string
  component_id?: string
  substance?: string
  substance_name?: string
  cas_number?: string
  concentration_ppm?: number
  threshold_ppm?: number
  basis?: string
  material?: string
  material_name?: string
}
interface TreeNode {
  id?: string
  name?: string
  reference?: string
  component_id?: string
  verdict?: string
  status?: string
  offending_substance?: string
  mass_grams?: number
  quantity?: number
  coverage_pct?: number
  children?: TreeNode[]
}
interface Rollup {
  product?: Product
  verdict?: string
  rohs_verdict?: string
  reach_verdict?: string
  offending?: Offending | null
  coveragePct?: number
  coverage_pct?: number
  tree?: TreeNode[]
}
interface ComplianceResult {
  id?: string
  product_id?: string
  rohs_verdict?: string
  reach_verdict?: string
  overall_verdict?: string
  offending_component_id?: string
  offending_substance?: string
  coverage_pct?: number
  details?: unknown
  computed_at?: string
  created_at?: string
}
interface AuditEvent {
  id: string
  user_id?: string
  action?: string
  entity_type?: string
  entity_id?: string
  metadata?: Record<string, unknown>
  created_at?: string
}

const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0)
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString() : '—')

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [r, c, a] = await Promise.all([
        api.getProductRollup(id),
        api.getCompliance(id).catch(() => null),
        api.getProductAudit(id).catch(() => []),
      ])
      setRollup(r ?? {})
      setCompliance(c)
      setAudit(Array.isArray(a) ? a : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load product')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  async function handleRecompute() {
    setRecomputing(true)
    setActionError(null)
    try {
      const result = await api.computeCompliance(id)
      setCompliance(result ?? null)
      // refresh rollup + audit to reflect the new verdict
      const [r, a] = await Promise.all([
        api.getProductRollup(id),
        api.getProductAudit(id).catch(() => audit),
      ])
      setRollup(r ?? rollup)
      setAudit(Array.isArray(a) ? a : audit)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  if (loading) return <PageSpinner label="Loading product roll-up..." />

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/products" className="text-sm text-slate-500 hover:text-slate-300">← Products</Link>
        <EmptyState
          title="Could not load this product"
          description={error}
          action={<Button variant="secondary" onClick={load}>Retry</Button>}
        />
      </div>
    )
  }

  const product = rollup?.product
  const verdict =
    rollup?.verdict ?? compliance?.overall_verdict ?? product?.compliance_status ?? 'unknown'
  const rohs = rollup?.rohs_verdict ?? compliance?.rohs_verdict
  const reach = rollup?.reach_verdict ?? compliance?.reach_verdict
  const coverage = num(rollup?.coveragePct ?? rollup?.coverage_pct ?? compliance?.coverage_pct)
  const offending = rollup?.offending
  const tree = rollup?.tree ?? []
  const computedAt = compliance?.computed_at ?? compliance?.created_at

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/products" className="text-sm text-slate-500 hover:text-slate-300">← Products</Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-100">{product?.name ?? 'Product'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {product?.sku && <span>SKU {product.sku}</span>}
            {product?.part_number && <span>· PN {product.part_number}</span>}
            {product?.category && <span>· {product.category}</span>}
            {product?.market_region && <span>· {product.market_region}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/products/${id}/bom`}>
            <Button variant="secondary" size="sm">Edit BOM</Button>
          </Link>
          <Button onClick={handleRecompute} disabled={recomputing}>
            {recomputing ? <Spinner label="Recomputing..." /> : 'Recompute compliance'}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {/* Verdict summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="col-span-2 flex flex-col justify-center px-5 py-4 lg:col-span-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Overall verdict</div>
          <div className="mt-2">
            <Badge tone={statusTone(verdict)} className="px-3 py-1 text-sm">{verdict}</Badge>
          </div>
          {computedAt && <div className="mt-2 text-xs text-slate-600">Computed {fmtDate(computedAt)}</div>}
        </Card>
        <Stat label="RoHS" value={<Badge tone={statusTone(rohs)}>{rohs ?? 'n/a'}</Badge>} />
        <Stat label="REACH / SVHC" value={<Badge tone={statusTone(reach)}>{reach ?? 'n/a'}</Badge>} />
        <Stat
          label="Declaration coverage"
          value={`${coverage.toFixed(0)}%`}
          tone={coverage >= 90 ? 'success' : coverage >= 60 ? 'warning' : 'danger'}
          hint="of BOM by mass"
        />
      </div>

      {/* Offending part/substance */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-100">Offending part &amp; substance</h2>
          <p className="text-xs text-slate-500">The single part and substance driving a failing verdict</p>
        </CardHeader>
        <CardBody>
          {!offending ? (
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              No offending substance — product is within all thresholds.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Detail label="Component" value={offending.component ?? offending.component_name ?? '—'} />
              <Detail label="Material" value={offending.material ?? offending.material_name ?? '—'} />
              <Detail
                label="Substance"
                value={
                  <span className="text-red-300">
                    {offending.substance ?? offending.substance_name ?? '—'}
                    {offending.cas_number && <span className="ml-1 text-xs text-slate-500">({offending.cas_number})</span>}
                  </span>
                }
              />
              <Detail
                label="Concentration vs threshold"
                value={
                  <span>
                    <span className="text-red-300">{num(offending.concentration_ppm).toLocaleString()} ppm</span>
                    {offending.threshold_ppm != null && (
                      <span className="text-slate-500"> / {num(offending.threshold_ppm).toLocaleString()} ppm</span>
                    )}
                    {offending.basis && <span className="ml-1 text-xs text-slate-600">{offending.basis}</span>}
                  </span>
                }
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Drill-down tree */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-100">BOM drill-down</h2>
          <p className="text-xs text-slate-500">Per-part verdict roll-up across the bill of materials</p>
        </CardHeader>
        <CardBody className="p-0">
          {tree.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No BOM structure"
              description="Add a bill of materials to compute a part-level verdict."
              action={
                <Link href={`/dashboard/products/${id}/bom`}>
                  <Button>Build BOM</Button>
                </Link>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Part</TH>
                  <TH>Reference</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Mass (g)</TH>
                  <TH>Offending substance</TH>
                  <TH>Verdict</TH>
                </TR>
              </THead>
              <TBody>{tree.map((node, i) => renderTreeRows(node, 0, i.toString()))}</TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Evidence / audit trail */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Evidence trail</h2>
            <p className="text-xs text-slate-500">Audit log of compliance events for this product</p>
          </div>
          <Link href="/dashboard/audit" className="text-xs font-medium text-lime-400 hover:text-lime-300">
            Full audit log →
          </Link>
        </CardHeader>
        <CardBody className="p-0">
          {audit.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-600">No recorded events yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {audit.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{ev.action ?? 'event'}</span>
                      {ev.entity_type && <Badge tone="neutral">{ev.entity_type}</Badge>}
                    </div>
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <pre className="mt-1 max-w-full overflow-x-auto rounded bg-slate-950/60 px-2 py-1 text-[11px] text-slate-500">
                        {JSON.stringify(ev.metadata)}
                      </pre>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-slate-600">{fmtDate(ev.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function renderTreeRows(node: TreeNode, depth: number, key: string): React.ReactNode {
  const v = node.verdict ?? node.status
  const rows: React.ReactNode[] = [
    <TR key={key}>
      <TD>
        <span style={{ paddingLeft: `${depth * 16}px` }} className="inline-flex items-center gap-1.5">
          {depth > 0 && <span className="text-slate-600">└</span>}
          <span className="font-medium text-slate-100">{node.name ?? node.component_id ?? 'Part'}</span>
        </span>
      </TD>
      <TD className="text-slate-400">{node.reference ?? '—'}</TD>
      <TD className="text-right text-slate-400">{node.quantity != null ? num(node.quantity) : '—'}</TD>
      <TD className="text-right text-slate-400">{node.mass_grams != null ? num(node.mass_grams).toFixed(2) : '—'}</TD>
      <TD className="text-slate-400">
        {node.offending_substance ? <span className="text-red-300">{node.offending_substance}</span> : '—'}
      </TD>
      <TD>{v ? <Badge tone={statusTone(v)}>{v}</Badge> : <span className="text-slate-600">—</span>}</TD>
    </TR>,
  ]
  if (node.children && node.children.length > 0) {
    node.children.forEach((child, i) => {
      rows.push(renderTreeRows(child, depth + 1, `${key}-${i}`))
    })
  }
  return rows
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-200">{value}</div>
    </div>
  )
}
