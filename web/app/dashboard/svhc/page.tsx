'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api, { getActiveWorkspaceId } from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface SvhcVersion {
  id: string
  version_label: string
  published_at: string | null
  substance_count: number | null
  created_at: string
}

interface SvhcSubstance {
  id: string
  list_version_id: string | null
  name: string
  cas_number: string | null
  ec_number: string | null
  date_of_inclusion: string | null
  reason_for_inclusion: string | null
  article_threshold_ppm: number
  created_at: string
}

interface WatchHit {
  product?: { id?: string; name?: string } | null
  substance?: { id?: string; name?: string; cas_number?: string } | null
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function SvhcPage() {
  const [versions, setVersions] = useState<SvhcVersion[]>([])
  const [substances, setSubstances] = useState<SvhcSubstance[]>([])
  const [watch, setWatch] = useState<WatchHit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [activeVersion, setActiveVersion] = useState<string>('')
  const [search, setSearch] = useState('')

  const [diffFrom, setDiffFrom] = useState('')
  const [diffTo, setDiffTo] = useState('')
  const [diffResult, setDiffResult] = useState<SvhcSubstance[] | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  const [versionModal, setVersionModal] = useState(false)
  const [substanceModal, setSubstanceModal] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadSubstances = useCallback(async (versionId: string) => {
    const data = await api.listSvhcSubstances(versionId || undefined)
    setSubstances(Array.isArray(data) ? data : [])
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const wsId = await getActiveWorkspaceId()
      const [vers, w] = await Promise.all([
        api.listSvhcVersions(),
        wsId ? api.svhcWatch(wsId).catch(() => ({ affected: [] })) : Promise.resolve({ affected: [] }),
      ])
      const vlist: SvhcVersion[] = Array.isArray(vers) ? vers : []
      setVersions(vlist)
      setWatch(Array.isArray(w?.affected) ? w.affected : [])
      const initial = activeVersion || vlist[0]?.id || ''
      setActiveVersion(initial)
      if (vlist.length >= 2) {
        setDiffFrom((f) => f || vlist[1].id)
        setDiffTo((t) => t || vlist[0].id)
      }
      await loadSubstances(initial)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SVHC data')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSubstances])

  useEffect(() => {
    load()
  }, [load])

  async function onSelectVersion(id: string) {
    setActiveVersion(id)
    try {
      await loadSubstances(id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to load substances')
    }
  }

  const versionLabel = useCallback(
    (id?: string | null) => versions.find((v) => v.id === id)?.version_label ?? (id ? id.slice(0, 8) : '—'),
    [versions],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return substances
    return substances.filter((s) =>
      `${s.name} ${s.cas_number ?? ''} ${s.ec_number ?? ''} ${s.reason_for_inclusion ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [substances, search])

  const latest = versions[0]

  async function runDiff() {
    if (!diffFrom || !diffTo) {
      setDiffError('Pick both versions')
      return
    }
    setDiffLoading(true)
    setDiffError(null)
    setDiffResult(null)
    try {
      const res = await api.svhcDiff(diffFrom, diffTo)
      setDiffResult(Array.isArray(res?.added) ? res.added : [])
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Diff failed')
    } finally {
      setDiffLoading(false)
    }
  }

  async function handleDeleteSubstance(s: SvhcSubstance) {
    if (!confirm(`Delete SVHC substance "${s.name}"?`)) return
    setBusyId(s.id)
    setActionError(null)
    try {
      await api.deleteSvhcSubstance(s.id)
      await loadSubstances(activeVersion)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading SVHC candidate list..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">SVHC Candidate List</h1>
          <p className="mt-1 text-sm text-slate-500">
            REACH Substances of Very High Concern. Track list versions, diff additions between snapshots, and watch
            for newly-affected products.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setVersionModal(true)}>
            New version
          </Button>
          <Button onClick={() => setSubstanceModal(true)} disabled={versions.length === 0}>
            Add substance
          </Button>
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
        <Stat label="List versions" value={versions.length} tone="lime" />
        <Stat label="Latest version" value={latest?.version_label ?? '—'} hint={fmtDate(latest?.published_at)} />
        <Stat label="Substances (selected)" value={substances.length} />
        <Stat
          label="Newly-affected products"
          value={watch.length}
          tone={watch.length ? 'danger' : 'success'}
        />
      </div>

      {/* Newly-affected watch */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Newly-affected watch</h2>
            <p className="text-xs text-slate-500">
              Products newly exposed after the latest candidate-list additions.
            </p>
          </div>
          {watch.length > 0 && <Badge tone="danger">{watch.length} flagged</Badge>}
        </CardHeader>
        <CardBody className="px-0 py-0">
          {watch.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No new exposure"
                description="No products are newly affected by recent SVHC additions."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Substance</TH>
                  <TH>CAS</TH>
                </TR>
              </THead>
              <TBody>
                {watch.map((h, i) => (
                  <TR key={i}>
                    <TD className="font-medium text-slate-200">{h.product?.name ?? '—'}</TD>
                    <TD className="text-amber-300">{h.substance?.name ?? '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{h.substance?.cas_number ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Version diff */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Version diff</h2>
          <p className="text-xs text-slate-500">Substances added between two list snapshots.</p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
              <select value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} className={inputCls}>
                <option value="">Select version</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.version_label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
              <select value={diffTo} onChange={(e) => setDiffTo(e.target.value)} className={inputCls}>
                <option value="">Select version</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.version_label}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={runDiff} disabled={diffLoading || !diffFrom || !diffTo}>
              {diffLoading ? <Spinner label="Diffing..." /> : 'Compare'}
            </Button>
          </div>
          {diffError && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{diffError}</div>}
          {diffResult !== null && (
            <div>
              <div className="mb-2 text-xs text-slate-400">
                <Badge tone="success">+{diffResult.length} added</Badge> from {versionLabel(diffFrom)} to{' '}
                {versionLabel(diffTo)}
              </div>
              {diffResult.length === 0 ? (
                <p className="text-sm text-slate-500">No substances added between these versions.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Substance</TH>
                      <TH>CAS</TH>
                      <TH>Included</TH>
                      <TH>Reason</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {diffResult.map((s) => (
                      <TR key={s.id}>
                        <TD className="font-medium text-emerald-300">{s.name}</TD>
                        <TD className="font-mono text-xs text-slate-400">{s.cas_number ?? '—'}</TD>
                        <TD>{fmtDate(s.date_of_inclusion)}</TD>
                        <TD className="text-slate-400">{s.reason_for_inclusion ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Substances of selected version */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">SVHC substances</h2>
            <p className="text-xs text-slate-500">Article threshold defaults to 1000 ppm (0.1% w/w).</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={activeVersion}
              onChange={(e) => onSelectVersion(e.target.value)}
              className={inputCls}
            >
              <option value="">All versions</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.version_label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search substances..."
              className={inputCls}
            />
          </div>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={substances.length === 0 ? 'No substances' : 'No matches'}
                description={
                  substances.length === 0
                    ? 'Add SVHC substances to this list version.'
                    : 'Adjust your search.'
                }
                action={
                  substances.length === 0 && versions.length > 0 ? (
                    <Button onClick={() => setSubstanceModal(true)}>Add substance</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Substance</TH>
                  <TH>CAS</TH>
                  <TH>EC</TH>
                  <TH>Version</TH>
                  <TH className="text-right">Threshold</TH>
                  <TH>Included</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-slate-200">
                      {s.name}
                      {s.reason_for_inclusion && (
                        <div className="text-xs font-normal text-slate-500">{s.reason_for_inclusion}</div>
                      )}
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">{s.cas_number ?? '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{s.ec_number ?? '—'}</TD>
                    <TD>
                      <Badge tone={statusTone('active')}>{versionLabel(s.list_version_id)}</Badge>
                    </TD>
                    <TD className="text-right text-lime-300">{s.article_threshold_ppm.toLocaleString()} ppm</TD>
                    <TD>{fmtDate(s.date_of_inclusion)}</TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === s.id}
                          onClick={() => handleDeleteSubstance(s)}
                        >
                          {busyId === s.id ? '...' : 'Delete'}
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

      {versionModal && (
        <VersionModal
          onClose={() => setVersionModal(false)}
          onSaved={async () => {
            setVersionModal(false)
            await load()
          }}
        />
      )}
      {substanceModal && (
        <SubstanceModal
          versions={versions}
          defaultVersion={activeVersion}
          onClose={() => setSubstanceModal(false)}
          onSaved={async () => {
            setSubstanceModal(false)
            await load()
            await loadSubstances(activeVersion)
          }}
        />
      )}
    </div>
  )
}

function VersionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [publishedAt, setPublishedAt] = useState('')
  const [count, setCount] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!label.trim()) {
      setErr('Version label is required')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await api.createSvhcVersion({
        version_label: label.trim(),
        published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
        substance_count: count ? Number(count) : 0,
      })
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
      title="New SVHC list version"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner label="Saving..." /> : 'Create version'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <Field label="Version label">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 2024-06 (240 substances)"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Published at">
            <input
              type="date"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Substance count">
            <input
              type="number"
              min={0}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function SubstanceModal({
  versions,
  defaultVersion,
  onClose,
  onSaved,
}: {
  versions: SvhcVersion[]
  defaultVersion: string
  onClose: () => void
  onSaved: () => void
}) {
  const [versionId, setVersionId] = useState(defaultVersion || versions[0]?.id || '')
  const [name, setName] = useState('')
  const [cas, setCas] = useState('')
  const [ec, setEc] = useState('')
  const [inclusion, setInclusion] = useState('')
  const [reason, setReason] = useState('')
  const [threshold, setThreshold] = useState('1000')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    if (!versionId) {
      setErr('Select a list version')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await api.createSvhcSubstance({
        list_version_id: versionId,
        name: name.trim(),
        cas_number: cas.trim() || null,
        ec_number: ec.trim() || null,
        date_of_inclusion: inclusion ? new Date(inclusion).toISOString() : null,
        reason_for_inclusion: reason.trim() || null,
        article_threshold_ppm: Number(threshold) || 1000,
      })
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
      title="Add SVHC substance"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner label="Saving..." /> : 'Add substance'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
        <Field label="List version">
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)} className={inputCls}>
            <option value="">Select version</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.version_label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="CAS number">
            <input value={cas} onChange={(e) => setCas(e.target.value)} className={inputCls} />
          </Field>
          <Field label="EC number">
            <input value={ec} onChange={(e) => setEc(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date of inclusion">
            <input type="date" value={inclusion} onChange={(e) => setInclusion(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Article threshold (ppm)">
            <input
              type="number"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Reason for inclusion">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Carcinogenic (Article 57a)"
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
