'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface DeclarationRequest {
  id: string
  workspace_id: string
  supplier_id: string | null
  component_id: string | null
  product_id: string | null
  status: string
  reminder_count: number
  due_date: string | null
  last_reminded_at: string | null
  created_at: string
}

interface Supplier {
  id: string
  workspace_id: string
  name: string
  region?: string | null
  responsiveness_score?: number | null
}

interface LedgerRow {
  supplier: Supplier | { id?: string; name?: string } | null
  requested: number
  received: number
  outstanding: number
}

const STATUS_OPTIONS = ['requested', 'reminded', 'received', 'overdue', 'cancelled']

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function isOverdue(r: DeclarationRequest): boolean {
  if (r.status === 'received' || r.status === 'cancelled') return false
  if (!r.due_date) return false
  return new Date(r.due_date).getTime() < Date.now()
}

export default function DeclarationRequestsPage() {
  const [requests, setRequests] = useState<DeclarationRequest[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [supplierFilter, setSupplierFilter] = useState<string>('')
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editing, setEditing] = useState<DeclarationRequest | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const supplierName = useCallback(
    (id?: string | null) => suppliers.find((s) => s.id === id)?.name ?? (id ? id.slice(0, 8) : 'Unassigned'),
    [suppliers],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [reqs, sups, led] = await Promise.all([
        api.listDeclarationRequests(),
        api.listSuppliers(),
        api.getRequestLedger().catch(() => ({ bySupplier: [] })),
      ])
      setRequests(Array.isArray(reqs) ? reqs : [])
      setSuppliers(Array.isArray(sups) ? sups : [])
      setLedger(Array.isArray(led?.bySupplier) ? led.bySupplier : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load declaration requests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return requests.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (supplierFilter && r.supplier_id !== supplierFilter) return false
      if (q) {
        const hay = `${supplierName(r.supplier_id)} ${r.component_id ?? ''} ${r.product_id ?? ''} ${r.status}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [requests, statusFilter, supplierFilter, search, supplierName])

  const stats = useMemo(() => {
    const total = requests.length
    const received = requests.filter((r) => r.status === 'received').length
    const outstanding = requests.filter((r) => r.status !== 'received' && r.status !== 'cancelled').length
    const overdue = requests.filter(isOverdue).length
    const completionPct = total ? Math.round((received / total) * 100) : 0
    return { total, received, outstanding, overdue, completionPct }
  }, [requests])

  async function handleRemind(r: DeclarationRequest) {
    setBusyId(r.id)
    setActionError(null)
    try {
      await api.remindRequest(r.id)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Reminder failed')
    } finally {
      setBusyId(null)
    }
  }

  async function handleStatus(r: DeclarationRequest, status: string) {
    setBusyId(r.id)
    setActionError(null)
    try {
      await api.updateDeclarationRequest(r.id, { status })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(r: DeclarationRequest) {
    if (!confirm('Delete this declaration request?')) return
    setBusyId(r.id)
    setActionError(null)
    try {
      await api.deleteDeclarationRequest(r.id)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading declaration requests..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Declaration Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            Collection workflow ledger. Track who has and has not returned RoHS/REACH declarations and chase
            outstanding requests.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setBulkOpen(true)}>
            Bulk request
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New request</Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}{' '}
          <button className="underline" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total requests" value={stats.total} />
        <Stat label="Received" value={stats.received} tone="success" hint={`${stats.completionPct}% complete`} />
        <Stat label="Outstanding" value={stats.outstanding} tone="warning" />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? 'danger' : 'default'} />
      </div>

      {/* Completion bar */}
      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Collection progress</span>
            <span>
              {stats.received} / {stats.total} received
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-lime-500 transition-all"
              style={{ width: `${stats.completionPct}%` }}
            />
          </div>
        </CardBody>
      </Card>

      {/* Ledger by supplier */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Ledger by supplier</h2>
          <p className="text-xs text-slate-500">Requested vs received vs outstanding, grouped by supplier.</p>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {ledger.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState title="No ledger data" description="Create requests to populate the supplier ledger." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Supplier</TH>
                  <TH className="text-right">Requested</TH>
                  <TH className="text-right">Received</TH>
                  <TH className="text-right">Outstanding</TH>
                  <TH className="w-48">Return rate</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.map((row, i) => {
                  const name = (row.supplier && 'name' in row.supplier && row.supplier.name) || 'Unassigned'
                  const rate = row.requested ? Math.round((row.received / row.requested) * 100) : 0
                  return (
                    <TR key={(row.supplier && 'id' in row.supplier && row.supplier.id) || i}>
                      <TD className="font-medium text-slate-200">{name}</TD>
                      <TD className="text-right">{row.requested}</TD>
                      <TD className="text-right text-emerald-300">{row.received}</TD>
                      <TD className="text-right text-amber-300">{row.outstanding}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${rate >= 80 ? 'bg-emerald-500' : rate >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                          <span className="w-9 text-right text-xs text-slate-400">{rate}%</span>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requests..."
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-lime-500/60 focus:outline-none sm:w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-lime-500/60 focus:outline-none"
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
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-lime-500/60 focus:outline-none"
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {(statusFilter || supplierFilter || search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter('')
              setSupplierFilter('')
              setSearch('')
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Requests table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={requests.length === 0 ? 'No declaration requests yet' : 'No requests match your filters'}
          description={
            requests.length === 0
              ? 'Create a request to start collecting supplier declarations.'
              : 'Adjust the filters above to see more.'
          }
          action={
            requests.length === 0 ? <Button onClick={() => setCreateOpen(true)}>New request</Button> : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Supplier</TH>
              <TH>Component</TH>
              <TH>Status</TH>
              <TH className="text-center">Reminders</TH>
              <TH>Due</TH>
              <TH>Last reminded</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => {
              const overdue = isOverdue(r)
              return (
                <TR key={r.id}>
                  <TD className="font-medium text-slate-200">{supplierName(r.supplier_id)}</TD>
                  <TD className="text-slate-400">{r.component_id ? r.component_id.slice(0, 8) : '—'}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      {overdue && <Badge tone="danger">overdue</Badge>}
                    </div>
                  </TD>
                  <TD className="text-center">{r.reminder_count}</TD>
                  <TD className={overdue ? 'text-red-300' : ''}>{fmtDate(r.due_date)}</TD>
                  <TD className="text-slate-400">{fmtDate(r.last_reminded_at)}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      {r.status !== 'received' && r.status !== 'cancelled' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === r.id}
                          onClick={() => handleRemind(r)}
                        >
                          {busyId === r.id ? '...' : 'Remind'}
                        </Button>
                      )}
                      {r.status !== 'received' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => handleStatus(r, 'received')}
                        >
                          Mark received
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => handleDelete(r)}>
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {createOpen && (
        <CreateRequestModal
          suppliers={suppliers}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => {
            setCreateOpen(false)
            await load()
          }}
        />
      )}
      {bulkOpen && (
        <BulkRequestModal
          suppliers={suppliers}
          onClose={() => setBulkOpen(false)}
          onSaved={async () => {
            setBulkOpen(false)
            await load()
          }}
        />
      )}
      {editing && (
        <EditRequestModal
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function CreateRequestModal({
  suppliers,
  onClose,
  onSaved,
}: {
  suppliers: Supplier[]
  onClose: () => void
  onSaved: () => void
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [componentId, setComponentId] = useState('')
  const [productId, setProductId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      const supplier = suppliers.find((s) => s.id === supplierId)
      const body: Record<string, unknown> = {
        supplier_id: supplierId || null,
        component_id: componentId || null,
        product_id: productId || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        status: 'requested',
      }
      if (supplier?.workspace_id) body.workspace_id = supplier.workspace_id
      await api.createDeclarationRequest(body)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New declaration request"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !supplierId}>
            {saving ? <Spinner label="Saving..." /> : 'Create request'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <Field label="Supplier">
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={inputCls}
          >
            <option value="">Select a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Component ID (optional)">
          <input value={componentId} onChange={(e) => setComponentId(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Product ID (optional)">
          <input value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Due date (optional)">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
    </Modal>
  )
}

function BulkRequestModal({
  suppliers,
  onClose,
  onSaved,
}: {
  suppliers: Supplier[]
  onClose: () => void
  onSaved: () => void
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [productId, setProductId] = useState('')
  const [componentIds, setComponentIds] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<number | null>(null)

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      const ids = componentIds
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const supplier = suppliers.find((s) => s.id === supplierId)
      const body: Record<string, unknown> = {
        supplier_id: supplierId || null,
        product_id: productId || null,
        component_ids: ids,
      }
      if (supplier?.workspace_id) body.workspace_id = supplier.workspace_id
      const res = await api.bulkCreateRequests(body)
      setResult(typeof res?.created === 'number' ? res.created : ids.length)
      setTimeout(onSaved, 700)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Bulk create failed')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk request declarations"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !supplierId}>
            {saving ? <Spinner label="Creating..." /> : 'Create requests'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        {result !== null && (
          <div className="rounded-lg bg-lime-500/10 px-3 py-2 text-sm text-lime-300">
            Created {result} request(s).
          </div>
        )}
        <p className="text-xs text-slate-500">
          Fan out requests across a BOM or supplier in one shot. Paste component IDs separated by commas, spaces,
          or new lines.
        </p>
        <Field label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
            <option value="">Select a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product ID (optional)">
          <input value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Component IDs">
          <textarea
            value={componentIds}
            onChange={(e) => setComponentIds(e.target.value)}
            rows={4}
            placeholder="comp-1, comp-2, comp-3"
            className={inputCls}
          />
        </Field>
      </div>
    </Modal>
  )
}

function EditRequestModal({
  request,
  onClose,
  onSaved,
}: {
  request: DeclarationRequest
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState(request.status)
  const [dueDate, setDueDate] = useState(request.due_date ? request.due_date.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await api.updateDeclarationRequest(request.id, {
        status,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit declaration request"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner label="Saving..." /> : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-lime-500/60 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
