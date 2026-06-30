'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Spinner, PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Supplier {
  id: string
  workspace_id?: string
  name: string
  region?: string | null
  accepted_formats?: string[] | null
  responsiveness_score?: number | null
  notes?: string | null
  created_at?: string
}

const FORMAT_OPTIONS = ['IPC-1752A', 'IEC 62474', 'Full Materials Declaration', 'PDF Certificate', 'Conflict Minerals (CMRT)']

function scoreTone(score?: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score == null) return 'neutral'
  if (score >= 0.75) return 'success'
  if (score >= 0.4) return 'warning'
  return 'danger'
}

function scorePct(score?: number | null): string {
  if (score == null) return '—'
  return `${Math.round(score * 100)}%`
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    region: '',
    responsiveness_score: '0.5',
    notes: '',
    accepted_formats: [] as string[],
  })

  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listSuppliers()
      setSuppliers(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suppliers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const regions = useMemo(() => {
    const set = new Set<string>()
    suppliers.forEach((s) => {
      if (s.region) set.add(s.region)
    })
    return Array.from(set).sort()
  }, [suppliers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter((s) => {
      if (regionFilter && s.region !== regionFilter) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.region ?? '').toLowerCase().includes(q) ||
        (s.notes ?? '').toLowerCase().includes(q)
      )
    })
  }, [suppliers, search, regionFilter])

  const avgScore = useMemo(() => {
    const scored = suppliers.filter((s) => s.responsiveness_score != null)
    if (!scored.length) return null
    return scored.reduce((a, s) => a + (s.responsiveness_score ?? 0), 0) / scored.length
  }, [suppliers])

  const responsive = suppliers.filter((s) => (s.responsiveness_score ?? 0) >= 0.75).length
  const atRisk = suppliers.filter((s) => (s.responsiveness_score ?? 1) < 0.4).length

  function toggleFormat(fmt: string) {
    setForm((f) => ({
      ...f,
      accepted_formats: f.accepted_formats.includes(fmt)
        ? f.accepted_formats.filter((x) => x !== fmt)
        : [...f.accepted_formats, fmt],
    }))
  }

  async function resolveWorkspaceId(): Promise<string | undefined> {
    try {
      const ws = await api.listWorkspaces()
      if (Array.isArray(ws) && ws.length) return ws[0].id
    } catch {
      // ignore — backend may infer workspace from user
    }
    return undefined
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('Supplier name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const workspace_id = await resolveWorkspaceId()
      const score = parseFloat(form.responsiveness_score)
      await api.createSupplier({
        ...(workspace_id ? { workspace_id } : {}),
        name: form.name.trim(),
        region: form.region.trim() || null,
        accepted_formats: form.accepted_formats,
        responsiveness_score: Number.isFinite(score) ? score : 0.5,
        notes: form.notes.trim() || null,
      })
      setCreateOpen(false)
      setForm({ name: '', region: '', responsiveness_score: '0.5', notes: '', accepted_formats: [] })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create supplier')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete(s: Supplier) {
    setDeleting(s.id)
    try {
      await api.deleteSupplier(s.id)
      setConfirmDelete(null)
      setSuppliers((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete supplier')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Suppliers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage the supply-chain partners behind your declarations and material data.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Add supplier</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total suppliers" value={suppliers.length} tone="lime" />
        <Stat label="Responsive (≥75%)" value={responsive} tone="success" />
        <Stat label="At risk (<40%)" value={atRisk} tone={atRisk ? 'danger' : 'default'} />
        <Stat label="Avg responsiveness" value={scorePct(avgScore)} hint="Across scored suppliers" />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, region, notes…"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
          />
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {(search || regionFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setRegionFilter('')
              }}
            >
              Clear
            </Button>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading suppliers…" />
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
      ) : suppliers.length === 0 ? (
        <EmptyState
          icon="🏭"
          title="No suppliers yet"
          description="Add your first supplier to start tracking declarations, contacts, and responsiveness."
          action={<Button onClick={() => setCreateOpen(true)}>+ Add supplier</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="No matching suppliers"
          description="Try adjusting your search or region filter."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Supplier</TH>
              <TH>Region</TH>
              <TH>Accepted formats</TH>
              <TH>Responsiveness</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((s) => (
              <TR key={s.id}>
                <TD>
                  <Link
                    href={`/dashboard/suppliers/${s.id}`}
                    className="font-medium text-slate-100 hover:text-lime-400"
                  >
                    {s.name}
                  </Link>
                  {s.notes && <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{s.notes}</div>}
                </TD>
                <TD>{s.region || <span className="text-slate-600">—</span>}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {(s.accepted_formats ?? []).length ? (
                      (s.accepted_formats ?? []).map((f) => (
                        <Badge key={f} tone="neutral">
                          {f}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                </TD>
                <TD>
                  <Badge tone={scoreTone(s.responsiveness_score)}>{scorePct(s.responsiveness_score)}</Badge>
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/suppliers/${s.id}`}>
                      <Button variant="secondary" size="sm">
                        View
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDelete(s)}
                      disabled={deleting === s.id}
                    >
                      {deleting === s.id ? '…' : 'Delete'}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="Add supplier"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="create-supplier-form" disabled={saving}>
              {saving ? <Spinner label="Saving…" /> : 'Create supplier'}
            </Button>
          </>
        }
      >
        <form id="create-supplier-form" onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Acme Components GmbH"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Region</label>
            <input
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              placeholder="EU, China, North America…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Responsiveness score ({scorePct(parseFloat(form.responsiveness_score))})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.responsiveness_score}
              onChange={(e) => setForm({ ...form, responsiveness_score: e.target.value })}
              className="w-full accent-lime-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Accepted declaration formats
            </label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((fmt) => {
                const active = form.accepted_formats.includes(fmt)
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => toggleFormat(fmt)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? 'border-lime-600/40 bg-lime-500/15 text-lime-300'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {fmt}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Internal notes about this supplier…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete supplier"
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
          Delete <span className="font-semibold text-slate-100">{confirmDelete?.name}</span>? This removes the supplier
          and its contacts. Declarations referencing it may be affected.
        </p>
      </Modal>
    </div>
  )
}
