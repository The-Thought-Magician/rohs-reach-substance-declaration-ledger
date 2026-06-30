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

interface Exemption {
  id: string
  exemption_number?: string
  description?: string
  scope?: string
  substance_name?: string
  expiry_date?: string | null
  created_at?: string
}

interface AppliedExemption {
  id: string
  workspace_id?: string
  exemption_id?: string
  component_id?: string | null
  material_id?: string | null
  justification?: string | null
  created_at?: string
}

interface Component {
  id: string
  name?: string
  manufacturer_part_number?: string
  manufacturer?: string
}

interface ExpiringResp {
  exemptions?: Exemption[]
  applied?: AppliedExemption[]
}

function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const d = new Date(date).getTime()
  if (isNaN(d)) return null
  return Math.ceil((d - Date.now()) / 86_400_000)
}

function fmtDate(date?: string | null): string {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const EMPTY_FORM = {
  exemption_number: '',
  description: '',
  scope: '',
  substance_name: '',
  expiry_date: '',
}

export default function ExemptionsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [exemptions, setExemptions] = useState<Exemption[]>([])
  const [expiring, setExpiring] = useState<ExpiringResp>({})
  const [applied, setApplied] = useState<AppliedExemption[]>([])
  const [components, setComponents] = useState<Component[]>([])

  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [windowDays, setWindowDays] = useState(90)

  // create / edit catalog entry
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Exemption | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // apply exemption
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyForm, setApplyForm] = useState({ exemption_id: '', component_id: '', justification: '' })
  const [applying, setApplying] = useState(false)

  async function loadAll(days = windowDays) {
    setError(null)
    try {
      let wsId: string | undefined
      try {
        const ws = await api.listWorkspaces()
        if (Array.isArray(ws) && ws.length > 0) wsId = ws[0].id
      } catch {
        /* workspace resolution is best-effort */
      }
      setWorkspaceId(wsId)
      const [ex, exp, app, comps] = await Promise.all([
        api.listExemptions(),
        api.listExpiringExemptions(days),
        api.listAppliedExemptions(wsId),
        api.listComponents(wsId ? { workspace_id: wsId } : undefined),
      ])
      setExemptions(Array.isArray(ex) ? ex : [])
      setExpiring(exp && typeof exp === 'object' ? exp : {})
      setApplied(Array.isArray(app) ? app : [])
      setComponents(Array.isArray(comps) ? comps : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load exemptions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reloadExpiring(days: number) {
    setWindowDays(days)
    try {
      const exp = await api.listExpiringExemptions(days)
      setExpiring(exp && typeof exp === 'object' ? exp : {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load expiring exemptions')
    }
  }

  const componentName = (id?: string | null) => {
    if (!id) return null
    const c = components.find((x) => x.id === id)
    return c ? c.name || c.manufacturer_part_number || c.id : id
  }

  const exemptionLabel = (id?: string) => {
    const e = exemptions.find((x) => x.id === id)
    return e ? e.exemption_number || e.description || e.id : id
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return exemptions
    return exemptions.filter((e) =>
      [e.exemption_number, e.description, e.scope, e.substance_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [exemptions, search])

  const appliedCount = (exemptionId: string) => applied.filter((a) => a.exemption_id === exemptionId).length

  const stats = useMemo(() => {
    const withExpiry = exemptions.filter((e) => e.expiry_date)
    const expired = withExpiry.filter((e) => (daysUntil(e.expiry_date) ?? 1) < 0).length
    const soon = (expiring.exemptions ?? []).length
    return {
      total: exemptions.length,
      applied: applied.length,
      expiringSoon: soon,
      expired,
    }
  }, [exemptions, applied, expiring])

  // ---- catalog CRUD ----
  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }
  function openEdit(e: Exemption) {
    setEditing(e)
    setForm({
      exemption_number: e.exemption_number ?? '',
      description: e.description ?? '',
      scope: e.scope ?? '',
      substance_name: e.substance_name ?? '',
      expiry_date: e.expiry_date ? e.expiry_date.slice(0, 10) : '',
    })
    setFormOpen(true)
  }

  async function saveExemption(ev: React.FormEvent) {
    ev.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        exemption_number: form.exemption_number.trim(),
        description: form.description.trim(),
        scope: form.scope.trim(),
        substance_name: form.substance_name.trim(),
        expiry_date: form.expiry_date ? new Date(form.expiry_date).toISOString() : null,
      }
      if (editing) await api.updateExemption(editing.id, body)
      else await api.createExemption(body)
      setFormOpen(false)
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save exemption')
    } finally {
      setSaving(false)
    }
  }

  async function removeExemption(e: Exemption) {
    if (!confirm(`Delete exemption ${e.exemption_number || e.id}? Applied uses will also be affected.`)) return
    setError(null)
    try {
      await api.deleteExemption(e.id)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exemption')
    }
  }

  // ---- apply ----
  function openApply(exemptionId?: string) {
    setApplyForm({ exemption_id: exemptionId ?? exemptions[0]?.id ?? '', component_id: '', justification: '' })
    setApplyOpen(true)
  }

  async function submitApply(ev: React.FormEvent) {
    ev.preventDefault()
    if (!applyForm.exemption_id || !applyForm.component_id) return
    setApplying(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        exemption_id: applyForm.exemption_id,
        component_id: applyForm.component_id,
        justification: applyForm.justification.trim() || null,
      }
      if (workspaceId) body.workspace_id = workspaceId
      await api.applyExemption(body)
      setApplyOpen(false)
      const app = await api.listAppliedExemptions(workspaceId)
      setApplied(Array.isArray(app) ? app : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply exemption')
    } finally {
      setApplying(false)
    }
  }

  async function removeApplied(a: AppliedExemption) {
    if (!confirm('Remove this applied exemption?')) return
    setError(null)
    try {
      await api.removeAppliedExemption(a.id)
      const app = await api.listAppliedExemptions(workspaceId)
      setApplied(Array.isArray(app) ? app : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove applied exemption')
    }
  }

  if (loading) return <PageSpinner label="Loading exemptions…" />

  // expiry calendar: exemptions with expiry, sorted ascending
  const calendar = [...exemptions]
    .filter((e) => e.expiry_date)
    .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())

  const maxRunway = Math.max(1, ...calendar.map((e) => Math.abs(daysUntil(e.expiry_date) ?? 0)))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Exemptions</h1>
          <p className="mt-1 text-sm text-slate-500">
            RoHS Annex III/IV exemption catalog, expiry runway, and per-component application.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openApply()} disabled={exemptions.length === 0 || components.length === 0}>
            Apply to component
          </Button>
          <Button onClick={openCreate}>+ New exemption</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Catalog entries" value={stats.total} tone="lime" />
        <Stat label="Applied uses" value={stats.applied} />
        <Stat label={`Expiring ≤ ${windowDays}d`} value={stats.expiringSoon} tone="warning" />
        <Stat label="Expired" value={stats.expired} tone={stats.expired > 0 ? 'danger' : 'default'} />
      </div>

      {/* Expiry calendar */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Expiry runway</h2>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Window</span>
            {[30, 60, 90, 180, 365].map((d) => (
              <button
                key={d}
                onClick={() => reloadExpiring(d)}
                className={`rounded-md border px-2 py-1 transition-colors ${
                  windowDays === d
                    ? 'border-lime-600/50 bg-lime-500/15 text-lime-300'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {calendar.length === 0 ? (
            <EmptyState title="No dated exemptions" description="Exemptions without an expiry date do not appear on the runway." />
          ) : (
            <div className="space-y-2">
              {calendar.map((e) => {
                const d = daysUntil(e.expiry_date)
                const expired = (d ?? 0) < 0
                const soon = !expired && (d ?? 9999) <= windowDays
                const pct = Math.min(100, (Math.abs(d ?? 0) / maxRunway) * 100)
                const barColor = expired ? 'bg-red-500/70' : soon ? 'bg-amber-400/70' : 'bg-lime-500/70'
                return (
                  <div key={e.id} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-sm text-slate-300" title={e.exemption_number || e.description}>
                      {e.exemption_number || e.description || e.id}
                    </div>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-800">
                      <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-28 shrink-0 text-right text-xs text-slate-400">{fmtDate(e.expiry_date)}</div>
                    <div className="w-24 shrink-0 text-right text-xs">
                      {expired ? (
                        <Badge tone="danger">Expired</Badge>
                      ) : soon ? (
                        <Badge tone="warning">{d}d left</Badge>
                      ) : (
                        <Badge tone="success">{d}d</Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Catalog table */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Exemption catalog</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, substance, scope…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500/60 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={exemptions.length === 0 ? 'No exemptions yet' : 'No matches'}
                description={
                  exemptions.length === 0
                    ? 'Add an exemption to start tracking expiry and applying it to components.'
                    : 'Try a different search term.'
                }
                action={exemptions.length === 0 ? <Button onClick={openCreate}>+ New exemption</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Description</TH>
                  <TH>Substance</TH>
                  <TH>Scope</TH>
                  <TH>Expiry</TH>
                  <TH>Applied</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => {
                  const d = daysUntil(e.expiry_date)
                  return (
                    <TR key={e.id}>
                      <TD className="font-mono text-slate-200">{e.exemption_number || '—'}</TD>
                      <TD className="max-w-xs">
                        <span className="line-clamp-2 text-slate-300">{e.description || '—'}</span>
                      </TD>
                      <TD>{e.substance_name || '—'}</TD>
                      <TD className="text-slate-400">{e.scope || '—'}</TD>
                      <TD>
                        {e.expiry_date ? (
                          <span className="flex items-center gap-2">
                            {fmtDate(e.expiry_date)}
                            {d !== null && d < 0 ? (
                              <Badge tone="danger">expired</Badge>
                            ) : d !== null && d <= windowDays ? (
                              <Badge tone="warning">{d}d</Badge>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-slate-500">no expiry</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={appliedCount(e.id) > 0 ? 'info' : 'neutral'}>{appliedCount(e.id)}</Badge>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openApply(e.id)} disabled={components.length === 0}>
                            Apply
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeExemption(e)}>
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
        </CardBody>
      </Card>

      {/* Applied exemptions */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Applied exemptions</h2>
        </CardHeader>
        <CardBody className="p-0">
          {applied.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing applied yet"
                description="Apply a catalog exemption to a component to suppress its restricted-substance findings."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Exemption</TH>
                  <TH>Component</TH>
                  <TH>Justification</TH>
                  <TH>Applied</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {applied.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-slate-200">{exemptionLabel(a.exemption_id)}</TD>
                    <TD>{componentName(a.component_id) || <span className="text-slate-500">workspace-wide</span>}</TD>
                    <TD className="max-w-sm text-slate-400">{a.justification || '—'}</TD>
                    <TD className="text-slate-500">{fmtDate(a.created_at)}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => removeApplied(a)}>
                        Remove
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create/Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit exemption' : 'New exemption'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="exemption-form" disabled={saving}>
              {saving ? <Spinner label="Saving…" /> : editing ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        <form id="exemption-form" onSubmit={saveExemption} className="space-y-3">
          <Field label="Exemption number">
            <input
              value={form.exemption_number}
              onChange={(e) => setForm({ ...form, exemption_number: e.target.value })}
              placeholder="e.g. 6(c)"
              className={inputCls}
              required
            />
          </Field>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Substance">
              <input
                value={form.substance_name}
                onChange={(e) => setForm({ ...form, substance_name: e.target.value })}
                placeholder="Lead"
                className={inputCls}
              />
            </Field>
            <Field label="Expiry date">
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Scope">
            <input
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
              placeholder="Copper alloy containing up to 4% lead by weight"
              className={inputCls}
            />
          </Field>
        </form>
      </Modal>

      {/* Apply modal */}
      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="Apply exemption"
        footer={
          <>
            <Button variant="secondary" onClick={() => setApplyOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button type="submit" form="apply-form" disabled={applying || !applyForm.component_id || !applyForm.exemption_id}>
              {applying ? <Spinner label="Applying…" /> : 'Apply'}
            </Button>
          </>
        }
      >
        <form id="apply-form" onSubmit={submitApply} className="space-y-3">
          <Field label="Exemption">
            <select
              value={applyForm.exemption_id}
              onChange={(e) => setApplyForm({ ...applyForm, exemption_id: e.target.value })}
              className={inputCls}
              required
            >
              <option value="">Select exemption…</option>
              {exemptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {(e.exemption_number || e.id) + (e.substance_name ? ` — ${e.substance_name}` : '')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Component">
            <select
              value={applyForm.component_id}
              onChange={(e) => setApplyForm({ ...applyForm, component_id: e.target.value })}
              className={inputCls}
              required
            >
              <option value="">Select component…</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.manufacturer_part_number || c.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Justification">
            <textarea
              value={applyForm.justification}
              onChange={(e) => setApplyForm({ ...applyForm, justification: e.target.value })}
              rows={3}
              placeholder="Why this exemption applies to the component…"
              className={inputCls}
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500/60 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
