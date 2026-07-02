'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api, { getActiveWorkspaceId } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Supplier {
  id: string
  name: string
}
interface Component {
  id: string
  name: string
  manufacturer_part_number?: string | null
}
interface Declaration {
  id: string
  workspace_id?: string
  supplier_id?: string | null
  component_id?: string | null
  format?: string | null
  status?: string | null
  document_url?: string | null
  valid_from?: string | null
  valid_until?: string | null
  confidence?: number | null
  superseded_by?: string | null
  created_at?: string
}
interface DeclarationSubstance {
  id: string
  declaration_id: string
  material_name?: string | null
  substance_name?: string | null
  cas_number?: string | null
  concentration_ppm?: number | null
  created_at?: string
}

const STATUS_OPTIONS = ['draft', 'received', 'validated', 'rejected', 'expired']
const FORMAT_OPTIONS = ['IPC-1752A', 'IEC 62474', 'Full Materials Declaration', 'PDF Certificate']

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString()
}

function isExpired(d: Declaration): boolean {
  if (!d.valid_until) return false
  const until = new Date(d.valid_until)
  return !Number.isNaN(until.getTime()) && until.getTime() < Date.now()
}

export default function DeclarationsPage() {
  const [declarations, setDeclarations] = useState<Declaration[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [components, setComponents] = useState<Component[]>([])
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [staleOnly, setStaleOnly] = useState(false)

  // Intake form
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [intake, setIntake] = useState({
    supplier_id: '',
    component_id: '',
    format: FORMAT_OPTIONS[0],
    status: 'received',
    document_url: '',
    valid_from: '',
    valid_until: '',
    confidence: '0.9',
  })

  // Detail / substance capture
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Declaration | null>(null)
  const [substances, setSubstances] = useState<DeclarationSubstance[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)

  const [subForm, setSubForm] = useState({ material_name: '', substance_name: '', cas_number: '', concentration_ppm: '' })
  const [addingSub, setAddingSub] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)
  const [deletingSub, setDeletingSub] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Declaration | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const supplierName = (idv?: string | null) => suppliers.find((s) => s.id === idv)?.name ?? '—'
  const componentName = (idv?: string | null) => {
    const c = components.find((x) => x.id === idv)
    if (!c) return '—'
    return c.manufacturer_part_number ? `${c.name} (${c.manufacturer_part_number})` : c.name
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const wsId = await getActiveWorkspaceId()
      if (!wsId) {
        setNoWorkspace(true)
        return
      }
      const [decls, sups, comps, stale] = await Promise.all([
        api.listDeclarations({ workspace_id: wsId }),
        api.listSuppliers(wsId).catch(() => []),
        api.listComponents({ workspace_id: wsId }).catch(() => []),
        api.listStaleDeclarations(undefined, wsId).catch(() => []),
      ])
      setDeclarations(Array.isArray(decls) ? decls : [])
      setSuppliers(Array.isArray(sups) ? sups : [])
      setComponents(Array.isArray(comps) ? comps : [])
      setStaleIds(new Set((Array.isArray(stale) ? stale : []).map((d: Declaration) => d.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load declarations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return declarations.filter((d) => {
      if (statusFilter && (d.status ?? '') !== statusFilter) return false
      if (supplierFilter && (d.supplier_id ?? '') !== supplierFilter) return false
      if (staleOnly && !staleIds.has(d.id)) return false
      if (!q) return true
      return (
        supplierName(d.supplier_id).toLowerCase().includes(q) ||
        componentName(d.component_id).toLowerCase().includes(q) ||
        (d.format ?? '').toLowerCase().includes(q) ||
        (d.status ?? '').toLowerCase().includes(q)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declarations, search, statusFilter, supplierFilter, staleOnly, staleIds, suppliers, components])

  const counts = useMemo(() => {
    const c = { total: declarations.length, validated: 0, stale: staleIds.size, expired: 0 }
    declarations.forEach((d) => {
      if ((d.status ?? '') === 'validated') c.validated++
      if (isExpired(d)) c.expired++
    })
    return c
  }, [declarations, staleIds])

  async function resolveWorkspaceId(): Promise<string | undefined> {
    try {
      const ws = await api.listWorkspaces()
      if (Array.isArray(ws) && ws.length) return ws[0].id
    } catch {
      // backend may infer
    }
    return undefined
  }

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault()
    if (!intake.supplier_id || !intake.component_id) {
      setIntakeError('Supplier and component are required')
      return
    }
    setSaving(true)
    setIntakeError(null)
    try {
      const workspace_id = await resolveWorkspaceId()
      const conf = parseFloat(intake.confidence)
      await api.createDeclaration({
        ...(workspace_id ? { workspace_id } : {}),
        supplier_id: intake.supplier_id,
        component_id: intake.component_id,
        format: intake.format,
        status: intake.status,
        document_url: intake.document_url.trim() || null,
        valid_from: intake.valid_from || null,
        valid_until: intake.valid_until || null,
        confidence: Number.isFinite(conf) ? conf : null,
      })
      setIntakeOpen(false)
      setIntake({
        supplier_id: '',
        component_id: '',
        format: FORMAT_OPTIONS[0],
        status: 'received',
        document_url: '',
        valid_from: '',
        valid_until: '',
        confidence: '0.9',
      })
      await load()
    } catch (e) {
      setIntakeError(e instanceof Error ? e.message : 'Failed to create declaration')
    } finally {
      setSaving(false)
    }
  }

  async function openDetail(d: Declaration) {
    setDetailId(d.id)
    setDetail(null)
    setSubstances([])
    setDetailError(null)
    setSubError(null)
    setSubForm({ material_name: '', substance_name: '', cas_number: '', concentration_ppm: '' })
    setDetailLoading(true)
    try {
      const res = await api.getDeclaration(d.id)
      // Endpoint returns { declaration, substances }
      setDetail(res?.declaration ?? d)
      setSubstances(Array.isArray(res?.substances) ? res.substances : [])
    } catch (e) {
      setDetail(d)
      setDetailError(e instanceof Error ? e.message : 'Failed to load declaration detail')
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    setDetailId(null)
    setDetail(null)
    setSubstances([])
  }

  async function changeStatus(status: string) {
    if (!detail) return
    setSavingStatus(true)
    try {
      const updated = await api.updateDeclaration(detail.id, { status })
      const next = updated?.declaration ?? updated ?? { ...detail, status }
      setDetail(next)
      setDeclarations((prev) => prev.map((x) => (x.id === detail.id ? { ...x, status } : x)))
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setSavingStatus(false)
    }
  }

  async function addSubstance(e: React.FormEvent) {
    e.preventDefault()
    if (!detail) return
    if (!subForm.substance_name.trim()) {
      setSubError('Substance name is required')
      return
    }
    setAddingSub(true)
    setSubError(null)
    try {
      const ppm = parseFloat(subForm.concentration_ppm)
      const created = await api.addDeclarationSubstance(detail.id, {
        material_name: subForm.material_name.trim() || null,
        substance_name: subForm.substance_name.trim(),
        cas_number: subForm.cas_number.trim() || null,
        concentration_ppm: Number.isFinite(ppm) ? ppm : null,
      })
      setSubstances((prev) => [...prev, created])
      setSubForm({ material_name: '', substance_name: '', cas_number: '', concentration_ppm: '' })
    } catch (e) {
      setSubError(e instanceof Error ? e.message : 'Failed to add substance')
    } finally {
      setAddingSub(false)
    }
  }

  async function deleteSubstance(substanceId: string) {
    setDeletingSub(substanceId)
    try {
      await api.deleteDeclarationSubstance(substanceId)
      setSubstances((prev) => prev.filter((s) => s.id !== substanceId))
    } catch (e) {
      setSubError(e instanceof Error ? e.message : 'Failed to delete substance')
    } finally {
      setDeletingSub(null)
    }
  }

  async function doDelete(d: Declaration) {
    setDeleting(d.id)
    try {
      await api.deleteDeclaration(d.id)
      setDeclarations((prev) => prev.filter((x) => x.id !== d.id))
      setConfirmDelete(null)
      if (detailId === d.id) closeDetail()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete declaration')
    } finally {
      setDeleting(null)
    }
  }

  if (noWorkspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-100">Declarations</h1>
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings before tracking declarations."
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Declarations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Intake supplier declarations, capture substance composition, and track validity.
          </p>
        </div>
        <Button onClick={() => setIntakeOpen(true)}>+ Intake declaration</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total" value={counts.total} tone="lime" />
        <Stat label="Validated" value={counts.validated} tone="success" />
        <Stat label="Stale / expiring" value={counts.stale} tone={counts.stale ? 'warning' : 'default'} />
        <Stat label="Expired" value={counts.expired} tone={counts.expired ? 'danger' : 'default'} />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, component, format…"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={staleOnly}
              onChange={(e) => setStaleOnly(e.target.checked)}
              className="h-4 w-4 accent-lime-500"
            />
            Stale only
          </label>
          {(search || statusFilter || supplierFilter || staleOnly) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setStatusFilter('')
                setSupplierFilter('')
                setStaleOnly(false)
              }}
            >
              Clear
            </Button>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading declarations…" />
      ) : error ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-red-300">{error}</p>
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : declarations.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No declarations yet"
          description="Intake your first supplier declaration to begin building compliance evidence."
          action={<Button onClick={() => setIntakeOpen(true)}>+ Intake declaration</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔎" title="No matching declarations" description="Adjust your filters to see results." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Supplier</TH>
              <TH>Component</TH>
              <TH>Format</TH>
              <TH>Status</TH>
              <TH>Valid until</TH>
              <TH>Confidence</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((d) => {
              const expired = isExpired(d)
              const stale = staleIds.has(d.id)
              return (
                <TR key={d.id}>
                  <TD className="font-medium text-slate-100">{supplierName(d.supplier_id)}</TD>
                  <TD>{componentName(d.component_id)}</TD>
                  <TD>{d.format || <span className="text-slate-600">—</span>}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={statusTone(d.status ?? undefined)}>{d.status || 'unknown'}</Badge>
                      {expired && <Badge tone="danger">expired</Badge>}
                      {!expired && stale && <Badge tone="warning">stale</Badge>}
                      {d.superseded_by && <Badge tone="neutral">superseded</Badge>}
                    </div>
                  </TD>
                  <TD>{fmtDate(d.valid_until)}</TD>
                  <TD>
                    {d.confidence == null ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      `${Math.round((d.confidence <= 1 ? d.confidence : d.confidence / 100) * 100)}%`
                    )}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => openDetail(d)}>
                        Substances
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmDelete(d)}
                        disabled={deleting === d.id}
                      >
                        {deleting === d.id ? '…' : 'Delete'}
                      </Button>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* Intake modal */}
      <Modal
        open={intakeOpen}
        onClose={() => !saving && setIntakeOpen(false)}
        title="Intake declaration"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIntakeOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="intake-form" disabled={saving}>
              {saving ? <Spinner label="Saving…" /> : 'Create declaration'}
            </Button>
          </>
        }
      >
        <form id="intake-form" onSubmit={submitIntake} className="space-y-4">
          {intakeError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {intakeError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Supplier</label>
              <select
                value={intake.supplier_id}
                onChange={(e) => setIntake({ ...intake, supplier_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
              >
                <option value="">Select supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Component</label>
              <select
                value={intake.component_id}
                onChange={(e) => setIntake({ ...intake, component_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
              >
                <option value="">Select component…</option>
                {components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.manufacturer_part_number ? `${c.name} (${c.manufacturer_part_number})` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Format</label>
              <select
                value={intake.format}
                onChange={(e) => setIntake({ ...intake, format: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Status</label>
              <select
                value={intake.status}
                onChange={(e) => setIntake({ ...intake, status: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Valid from</label>
              <input
                type="date"
                value={intake.valid_from}
                onChange={(e) => setIntake({ ...intake, valid_from: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Valid until</label>
              <input
                type="date"
                value={intake.valid_until}
                onChange={(e) => setIntake({ ...intake, valid_until: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Document URL</label>
              <input
                value={intake.document_url}
                onChange={(e) => setIntake({ ...intake, document_url: e.target.value })}
                placeholder="https://…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Confidence ({Math.round((parseFloat(intake.confidence) || 0) * 100)}%)
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={intake.confidence}
                onChange={(e) => setIntake({ ...intake, confidence: e.target.value })}
                className="w-full accent-lime-500"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Detail / substance capture modal */}
      <Modal
        open={!!detailId}
        onClose={closeDetail}
        title="Declaration detail"
        className="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={closeDetail}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <div className="py-8">
            <Spinner label="Loading…" />
          </div>
        ) : (
          <div className="space-y-5">
            {detailError && (
              <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {detailError}
              </div>
            )}
            {detail && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Supplier</div>
                  <div className="text-slate-200">{supplierName(detail.supplier_id)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Component</div>
                  <div className="text-slate-200">{componentName(detail.component_id)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Format</div>
                  <div className="text-slate-200">{detail.format || '—'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Valid until</div>
                  <div className="text-slate-200">{fmtDate(detail.valid_until)}</div>
                </div>
                {detail.document_url && (
                  <div className="col-span-2">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Document</div>
                    <a
                      href={detail.document_url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-lime-400 hover:underline"
                    >
                      {detail.document_url}
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Status control */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Status:</span>
              {STATUS_OPTIONS.map((s) => {
                const active = (detail?.status ?? '') === s
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={savingStatus || active}
                    onClick={() => changeStatus(s)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60 ${
                      active
                        ? 'border-lime-600/40 bg-lime-500/15 text-lime-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
              {savingStatus && <Spinner />}
            </div>

            {/* Captured substances */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">Captured substances</h3>
                <span className="text-xs text-slate-500">{substances.length} row(s)</span>
              </div>
              {substances.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 px-4 py-6 text-center text-sm text-slate-500">
                  No substances captured yet. Add rows below from the declaration document.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Material</TH>
                      <TH>Substance</TH>
                      <TH>CAS</TH>
                      <TH>ppm</TH>
                      <TH></TH>
                    </TR>
                  </THead>
                  <TBody>
                    {substances.map((s) => {
                      const over = (s.concentration_ppm ?? 0) >= 1000
                      return (
                        <TR key={s.id}>
                          <TD>{s.material_name || <span className="text-slate-600">—</span>}</TD>
                          <TD className="text-slate-100">{s.substance_name}</TD>
                          <TD className="font-mono text-xs">{s.cas_number || '—'}</TD>
                          <TD>
                            {s.concentration_ppm == null ? (
                              '—'
                            ) : (
                              <span className={over ? 'font-semibold text-amber-300' : ''}>
                                {s.concentration_ppm.toLocaleString()}
                              </span>
                            )}
                          </TD>
                          <TD className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteSubstance(s.id)}
                              disabled={deletingSub === s.id}
                            >
                              {deletingSub === s.id ? '…' : '✕'}
                            </Button>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </div>

            {/* Add substance form */}
            <form onSubmit={addSubstance} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">Add substance row</h4>
              {subError && (
                <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {subError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <input
                  value={subForm.material_name}
                  onChange={(e) => setSubForm({ ...subForm, material_name: e.target.value })}
                  placeholder="Material"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
                />
                <input
                  value={subForm.substance_name}
                  onChange={(e) => setSubForm({ ...subForm, substance_name: e.target.value })}
                  placeholder="Substance *"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
                />
                <input
                  value={subForm.cas_number}
                  onChange={(e) => setSubForm({ ...subForm, cas_number: e.target.value })}
                  placeholder="CAS no."
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
                />
                <input
                  type="number"
                  step="any"
                  value={subForm.concentration_ppm}
                  onChange={(e) => setSubForm({ ...subForm, concentration_ppm: e.target.value })}
                  placeholder="ppm"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={addingSub}>
                  {addingSub ? <Spinner label="Adding…" /> : '+ Add substance'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete declaration"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={!!deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && doDelete(confirmDelete)} disabled={!!deleting}>
              {deleting ? <Spinner label="Deleting…" /> : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete this declaration for{' '}
          <span className="font-semibold text-slate-100">{supplierName(confirmDelete?.supplier_id)}</span>? Captured
          substance rows will be removed too.
        </p>
      </Modal>
    </div>
  )
}
