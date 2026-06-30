'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface AuditEvent {
  id: string
  workspace_id?: string
  user_id?: string | null
  action?: string
  entity_type?: string
  entity_id?: string
  metadata?: Record<string, unknown> | null
  created_at?: string
}

const ENTITY_TYPES = [
  'product',
  'component',
  'material',
  'supplier',
  'declaration',
  'declaration_request',
  'compliance_result',
  'exemption',
  'task',
  'report',
]

function actionTone(action?: string): Parameters<typeof Badge>[0]['tone'] {
  const a = (action ?? '').toLowerCase()
  if (a.includes('delete') || a.includes('fail') || a.includes('non-compliant')) return 'danger'
  if (a.includes('create') || a.includes('compliant') || a.includes('pass')) return 'success'
  if (a.includes('update') || a.includes('remind') || a.includes('compute')) return 'info'
  if (a.includes('export') || a.includes('generate')) return 'lime'
  return 'neutral'
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}

function relative(s?: string): string {
  if (!s) return ''
  const d = new Date(s).getTime()
  if (Number.isNaN(d)) return ''
  const diff = Date.now() - d
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export default function AuditPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  const [events, setEvents] = useState<AuditEvent[]>([])

  // Filters
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [limit, setLimit] = useState(200)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AuditEvent | null>(null)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        let wsId = workspaceId
        if (wsId === undefined) {
          try {
            const ws = await api.listWorkspaces()
            wsId = Array.isArray(ws) && ws.length ? ws[0].id : undefined
            setWorkspaceId(wsId ?? '')
          } catch {
            wsId = undefined
            setWorkspaceId('')
          }
        }
        const rows = await api.listAudit({
          workspace_id: wsId || undefined,
          entity_type: entityType || undefined,
          entity_id: entityId || undefined,
          limit,
        })
        setEvents(Array.isArray(rows) ? rows : [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load audit log')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [workspaceId, entityType, entityId, limit],
  )

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter((e) =>
      [e.action, e.entity_type, e.entity_id, e.user_id, JSON.stringify(e.metadata ?? {})]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [events, search])

  const stats = useMemo(() => {
    const byAction = new Map<string, number>()
    const byEntity = new Map<string, number>()
    let last24 = 0
    const cutoff = Date.now() - 24 * 3600 * 1000
    for (const e of events) {
      byAction.set(e.action ?? 'unknown', (byAction.get(e.action ?? 'unknown') ?? 0) + 1)
      byEntity.set(e.entity_type ?? 'unknown', (byEntity.get(e.entity_type ?? 'unknown') ?? 0) + 1)
      if (e.created_at && new Date(e.created_at).getTime() >= cutoff) last24++
    }
    return {
      total: events.length,
      last24,
      distinctActions: byAction.size,
      distinctEntities: byEntity.size,
      topActions: [...byAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    }
  }, [events])

  const maxActionCount = Math.max(1, ...stats.topActions.map(([, n]) => n))

  if (loading) return <PageSpinner label="Loading audit log..." />

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Audit & Evidence Log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Immutable trail of every compliance action across the workspace — your evidence pack for auditors.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load({ silent: true })} disabled={refreshing}>
          {refreshing ? <Spinner /> : '↻ Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Events" value={stats.total} tone="lime" />
        <Stat label="Last 24h" value={stats.last24} tone="success" hint="recent activity" />
        <Stat label="Action Types" value={stats.distinctActions} />
        <Stat label="Entity Types" value={stats.distinctEntities} />
      </div>

      {stats.topActions.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Activity Breakdown</h2>
          </CardHeader>
          <CardBody className="space-y-2">
            {stats.topActions.map(([action, count]) => (
              <div key={action} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-xs text-slate-400" title={action}>
                  {action}
                </div>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-lime-500/70"
                    style={{ width: `${(count / maxActionCount) * 100}%` }}
                  />
                </div>
                <div className="w-10 shrink-0 text-right text-xs font-medium text-slate-300">{count}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-slate-500">Entity type</label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="">All types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-slate-500">Entity ID</label>
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="filter by entity id"
              className="w-48 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-slate-500">Limit</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={() => load()} disabled={refreshing}>
            Apply
          </Button>
          {(entityType || entityId) && (
            <Button
              variant="ghost"
              onClick={() => {
                setEntityType('')
                setEntityId('')
                setTimeout(() => load(), 0)
              }}
            >
              Clear
            </Button>
          )}
          <div className="ml-auto flex flex-col">
            <label className="mb-1 text-xs font-medium text-slate-500">Quick search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search loaded events..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title="No audit events"
          description={
            events.length === 0
              ? 'No actions have been recorded yet. As you compute compliance, intake declarations, or edit products, events will appear here.'
              : 'No events match your current filters.'
          }
          icon="🗂️"
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Entity ID</TH>
              <TH>User</TH>
              <TH className="text-right">Details</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((e) => (
              <TR key={e.id}>
                <TD>
                  <div className="text-slate-200">{relative(e.created_at)}</div>
                  <div className="text-xs text-slate-600">{fmtDate(e.created_at)}</div>
                </TD>
                <TD>
                  <Badge tone={actionTone(e.action)}>{e.action ?? 'unknown'}</Badge>
                </TD>
                <TD>
                  <span className="text-slate-300">{e.entity_type ?? '—'}</span>
                </TD>
                <TD className="font-mono text-xs text-slate-500">{e.entity_id ?? '—'}</TD>
                <TD className="font-mono text-xs text-slate-500">{e.user_id ?? 'system'}</TD>
                <TD className="text-right">
                  {e.metadata && Object.keys(e.metadata).length > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setSelected(e)}>
                      View
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {selected && (
        <EventDetail event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function EventDetail({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Badge tone={actionTone(event.action)}>{event.action ?? 'event'}</Badge>
            <span className="text-sm text-slate-400">{event.entity_type}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Event ID" value={event.id} mono />
            <Field label="Entity ID" value={event.entity_id ?? '—'} mono />
            <Field label="User" value={event.user_id ?? 'system'} mono />
            <Field label="Timestamp" value={fmtDate(event.created_at)} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Metadata</div>
            <pre className="max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-lime-300">
              {JSON.stringify(event.metadata ?? {}, null, 2)}
            </pre>
          </div>
        </div>
        <div className="flex justify-end border-t border-slate-800 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 break-all text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  )
}
