'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface RestrictedSubstance {
  id: string
  name: string
  cas_number: string | null
  ec_number: string | null
  max_concentration_ppm: number
  threshold_basis: string | null
  restriction_basis: string | null
  list_version: string | null
  created_at: string
}

interface FormState {
  name: string
  cas_number: string
  ec_number: string
  max_concentration_ppm: string
  threshold_basis: string
  restriction_basis: string
  list_version: string
}

const EMPTY_FORM: FormState = {
  name: '',
  cas_number: '',
  ec_number: '',
  max_concentration_ppm: '1000',
  threshold_basis: 'homogeneous_material',
  restriction_basis: '',
  list_version: 'RoHS3',
}

function ppmToPct(ppm: number): string {
  return `${(ppm / 10000).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`
}

export default function RestrictedSubstancesPage() {
  const [rows, setRows] = useState<RestrictedSubstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [versionFilter, setVersionFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RestrictedSubstance | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listRestrictedSubstances()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load restricted substances')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const versions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.list_version).filter(Boolean) as string[])).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (versionFilter && r.list_version !== versionFilter) return false
      if (q) {
        const hay = `${r.name} ${r.cas_number ?? ''} ${r.ec_number ?? ''} ${r.restriction_basis ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, versionFilter])

  const stats = useMemo(() => {
    const total = rows.length
    const withCas = rows.filter((r) => r.cas_number).length
    const strictest = rows.reduce(
      (min, r) => (r.max_concentration_ppm < min ? r.max_concentration_ppm : min),
      rows.length ? Infinity : 0,
    )
    return { total, withCas, versions: versions.length, strictest: strictest === Infinity ? 0 : strictest }
  }, [rows, versions])

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }
  function openEdit(r: RestrictedSubstance) {
    setEditing(r)
    setModalOpen(true)
  }

  async function handleDelete(r: RestrictedSubstance) {
    if (!confirm(`Delete restricted substance "${r.name}"?`)) return
    setBusyId(r.id)
    setActionError(null)
    try {
      await api.deleteRestrictedSubstance(r.id)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading RoHS catalog..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">RoHS Restricted Substances</h1>
          <p className="mt-1 text-sm text-slate-500">
            The restriction catalog the compliance engine checks against. Thresholds apply on a homogeneous-material
            basis.
          </p>
        </div>
        <Button onClick={openCreate}>Add substance</Button>
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
        <Stat label="Restricted substances" value={stats.total} tone="lime" />
        <Stat label="With CAS number" value={stats.withCas} />
        <Stat label="List versions" value={stats.versions} />
        <Stat
          label="Strictest limit"
          value={stats.total ? `${stats.strictest.toLocaleString()} ppm` : '—'}
          tone="warning"
          hint={stats.total ? ppmToPct(stats.strictest) : undefined}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, CAS, EC..."
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-lime-500/60 focus:outline-none sm:w-72"
        />
        <select
          value={versionFilter}
          onChange={(e) => setVersionFilter(e.target.value)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-lime-500/60 focus:outline-none"
        >
          <option value="">All list versions</option>
          {versions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {(search || versionFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setVersionFilter('')
            }}
          >
            Clear
          </Button>
        )}
        <span className="text-xs text-slate-500 sm:ml-auto">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No restricted substances' : 'No matches'}
          description={
            rows.length === 0
              ? 'Add the RoHS-restricted substances the engine should screen for.'
              : 'Adjust your search or filter.'
          }
          action={rows.length === 0 ? <Button onClick={openCreate}>Add substance</Button> : undefined}
        />
      ) : (
        <Card>
          <CardBody className="px-0 py-0">
            <Table>
              <THead>
                <TR>
                  <TH>Substance</TH>
                  <TH>CAS</TH>
                  <TH>EC</TH>
                  <TH className="text-right">Max conc.</TH>
                  <TH>Basis</TH>
                  <TH>List</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-slate-200">
                      {r.name}
                      {r.restriction_basis && (
                        <div className="text-xs font-normal text-slate-500">{r.restriction_basis}</div>
                      )}
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">{r.cas_number ?? '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{r.ec_number ?? '—'}</TD>
                    <TD className="text-right">
                      <span className="font-semibold text-lime-300">
                        {r.max_concentration_ppm.toLocaleString()} ppm
                      </span>
                      <div className="text-xs text-slate-500">{ppmToPct(r.max_concentration_ppm)}</div>
                    </TD>
                    <TD>
                      <Badge tone="neutral">{r.threshold_basis ?? 'homogeneous_material'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone="info">{r.list_version ?? '—'}</Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => handleDelete(r)}
                        >
                          {busyId === r.id ? '...' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {modalOpen && (
        <SubstanceModal
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

function SubstanceModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: RestrictedSubstance | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          name: editing.name,
          cas_number: editing.cas_number ?? '',
          ec_number: editing.ec_number ?? '',
          max_concentration_ppm: String(editing.max_concentration_ppm),
          threshold_basis: editing.threshold_basis ?? 'homogeneous_material',
          restriction_basis: editing.restriction_basis ?? '',
          list_version: editing.list_version ?? 'RoHS3',
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof FormState>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function submit() {
    const ppm = Number(form.max_concentration_ppm)
    if (!form.name.trim()) {
      setErr('Name is required')
      return
    }
    if (!isFinite(ppm) || ppm < 0) {
      setErr('Max concentration must be a non-negative number')
      return
    }
    setSaving(true)
    setErr(null)
    const body = {
      name: form.name.trim(),
      cas_number: form.cas_number.trim() || null,
      ec_number: form.ec_number.trim() || null,
      max_concentration_ppm: ppm,
      threshold_basis: form.threshold_basis.trim() || 'homogeneous_material',
      restriction_basis: form.restriction_basis.trim() || null,
      list_version: form.list_version.trim() || 'RoHS3',
    }
    try {
      if (editing) await api.updateRestrictedSubstance(editing.id, body)
      else await api.createRestrictedSubstance(body)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit restricted substance' : 'Add restricted substance'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner label="Saving..." /> : editing ? 'Save changes' : 'Add substance'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <Field label="Name">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="CAS number">
            <input value={form.cas_number} onChange={(e) => set('cas_number', e.target.value)} className={inputCls} />
          </Field>
          <Field label="EC number">
            <input value={form.ec_number} onChange={(e) => set('ec_number', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Max concentration (ppm)">
          <input
            type="number"
            min={0}
            value={form.max_concentration_ppm}
            onChange={(e) => set('max_concentration_ppm', e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-slate-500">
            {isFinite(Number(form.max_concentration_ppm)) ? ppmToPct(Number(form.max_concentration_ppm)) : ''}
          </span>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Threshold basis">
            <select
              value={form.threshold_basis}
              onChange={(e) => set('threshold_basis', e.target.value)}
              className={inputCls}
            >
              <option value="homogeneous_material">homogeneous_material</option>
              <option value="article">article</option>
              <option value="product">product</option>
            </select>
          </Field>
          <Field label="List version">
            <input
              value={form.list_version}
              onChange={(e) => set('list_version', e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Restriction basis (optional)">
          <input
            value={form.restriction_basis}
            onChange={(e) => set('restriction_basis', e.target.value)}
            placeholder="e.g. EU RoHS Annex II"
            className={inputCls}
          />
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
