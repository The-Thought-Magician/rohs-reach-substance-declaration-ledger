'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'

interface Report {
  id: string
  workspace_id?: string
  type?: string
  title?: string
  payload?: Record<string, unknown> | null
  owner_id?: string
  created_at?: string
}

type ReportType = 'portfolio' | 'scip' | 'exemption-expiry' | 'supplier-coverage'

const REPORT_TYPES: { type: ReportType; label: string; desc: string; icon: string }[] = [
  {
    type: 'portfolio',
    label: 'Portfolio Compliance',
    desc: 'RoHS/REACH verdicts and coverage across every product.',
    icon: '📊',
  },
  {
    type: 'scip',
    label: 'SCIP Readiness',
    desc: 'Articles requiring ECHA SCIP notification (SVHC > 0.1%).',
    icon: '🧾',
  },
  {
    type: 'exemption-expiry',
    label: 'Exemption Expiry',
    desc: 'RoHS exemptions approaching expiry and the parts that rely on them.',
    icon: '⏳',
  },
  {
    type: 'supplier-coverage',
    label: 'Supplier Coverage',
    desc: 'Declaration coverage and responsiveness per supplier.',
    icon: '🏭',
  },
]

function typeTone(t?: string): Parameters<typeof Badge>[0]['tone'] {
  switch (t) {
    case 'portfolio':
      return 'lime'
    case 'scip':
      return 'info'
    case 'exemption-expiry':
      return 'warning'
    case 'supplier-coverage':
      return 'success'
    default:
      return 'neutral'
  }
}

function typeLabel(t?: string): string {
  return REPORT_TYPES.find((r) => r.type === t)?.label ?? t ?? 'Report'
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [reports, setReports] = useState<Report[]>([])

  const [generating, setGenerating] = useState<ReportType | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  const [viewing, setViewing] = useState<Report | null>(null)
  const [viewLoading, setViewLoading] = useState(false)

  const [deleting, setDeleting] = useState<Report | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [filterType, setFilterType] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let wsId = workspaceId
      if (!wsId) {
        try {
          const ws = await api.listWorkspaces()
          wsId = Array.isArray(ws) && ws.length ? ws[0].id : ''
          setWorkspaceId(wsId)
        } catch {
          wsId = ''
        }
      }
      const rows = await api.listReports(wsId || undefined)
      setReports(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generate = async (type: ReportType) => {
    setGenerating(type)
    setGenError(null)
    try {
      if (!workspaceId) {
        throw new Error('No workspace available. Seed sample data or create a workspace first.')
      }
      await api.generateReport({ workspace_id: workspaceId, type })
      await load()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setGenerating(null)
    }
  }

  const openReport = async (r: Report) => {
    setViewing(r)
    // Fetch full detail (payload) — list may be trimmed.
    if (!r.payload) {
      setViewLoading(true)
      try {
        const full = await api.getReport(r.id)
        setViewing(full ?? r)
      } catch {
        // keep summary version
      } finally {
        setViewLoading(false)
      }
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteReport(deleting.id)
      setReports((prev) => prev.filter((r) => r.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to delete report')
    } finally {
      setDeleteBusy(false)
    }
  }

  const filtered = useMemo(
    () => (filterType ? reports.filter((r) => r.type === filterType) : reports),
    [reports, filterType],
  )

  const counts = useMemo(() => {
    const byType = new Map<string, number>()
    for (const r of reports) byType.set(r.type ?? 'other', (byType.get(r.type ?? 'other') ?? 0) + 1)
    return byType
  }, [reports])

  const latest = reports[0]

  if (loading) return <PageSpinner label="Loading reports..." />

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Reports Center</h1>
        <p className="mt-1 text-sm text-slate-500">
          Generate point-in-time compliance reports and keep a history of every snapshot you produce.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Reports" value={reports.length} tone="lime" />
        <Stat label="Report Types" value={counts.size} />
        <Stat
          label="Latest"
          value={latest ? typeLabel(latest.type).split(' ')[0] : '—'}
          hint={latest ? fmtDate(latest.created_at) : 'none yet'}
        />
        <Stat label="Portfolio Snapshots" value={counts.get('portfolio') ?? 0} tone="success" />
      </div>

      <Card className="mb-8">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Generate a Report</h2>
        </CardHeader>
        <CardBody>
          {genError && (
            <div className="mb-3 rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {genError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {REPORT_TYPES.map((rt) => (
              <div
                key={rt.type}
                className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-4"
              >
                <div className="mb-2 text-2xl">{rt.icon}</div>
                <div className="text-sm font-semibold text-slate-100">{rt.label}</div>
                <p className="mt-1 flex-1 text-xs text-slate-500">{rt.desc}</p>
                <Button
                  className="mt-3 w-full"
                  size="sm"
                  onClick={() => generate(rt.type)}
                  disabled={generating !== null}
                >
                  {generating === rt.type ? <Spinner label="Generating..." /> : 'Generate'}
                </Button>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Report History</h2>
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-lime-500 focus:outline-none"
          >
            <option value="">All types</option>
            {REPORT_TYPES.map((rt) => (
              <option key={rt.type} value={rt.type}>
                {rt.label}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={() => load()}>
            ↻ Refresh
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description={
            reports.length === 0
              ? 'Generate your first compliance report using the cards above.'
              : 'No reports match the selected type.'
          }
          icon="📄"
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Type</TH>
              <TH>Generated</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => (
              <TR key={r.id}>
                <TD>
                  <button
                    onClick={() => openReport(r)}
                    className="text-left font-medium text-slate-100 hover:text-lime-300"
                  >
                    {r.title ?? typeLabel(r.type)}
                  </button>
                </TD>
                <TD>
                  <Badge tone={typeTone(r.type)}>{typeLabel(r.type)}</Badge>
                </TD>
                <TD className="text-slate-400">{fmtDate(r.created_at)}</TD>
                <TD>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openReport(r)}>
                      View
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setDeleting(r)}>
                      Delete
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* View report modal */}
      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          title={
            <span className="flex items-center gap-2">
              {viewing.title ?? typeLabel(viewing.type)}
              <Badge tone={typeTone(viewing.type)}>{typeLabel(viewing.type)}</Badge>
            </span>
          }
          className="max-w-3xl"
          footer={
            <Button variant="secondary" onClick={() => setViewing(null)}>
              Close
            </Button>
          }
        >
          <div className="mb-3 text-xs text-slate-500">Generated {fmtDate(viewing.created_at)}</div>
          {viewLoading ? (
            <div className="py-8 text-center">
              <Spinner label="Loading report payload..." />
            </div>
          ) : (
            <ReportPayload payload={viewing.payload} />
          )}
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal
          open
          onClose={() => (deleteBusy ? null : setDeleting(null))}
          title="Delete report?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? <Spinner /> : 'Delete'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-400">
            This permanently removes{' '}
            <span className="font-medium text-slate-200">{deleting.title ?? typeLabel(deleting.type)}</span> from
            your report history. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}

function ReportPayload({ payload }: { payload?: Record<string, unknown> | null }) {
  if (!payload || Object.keys(payload).length === 0) {
    return <p className="text-sm text-slate-500">This report has no detailed payload.</p>
  }

  // Render any top-level array of objects as a table; scalars as stat-style rows.
  const scalars: [string, unknown][] = []
  const tables: [string, Record<string, unknown>[]][] = []
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      tables.push([k, v as Record<string, unknown>[]])
    } else if (typeof v !== 'object' || v === null) {
      scalars.push([k, v])
    } else {
      tables.push([k, [v as Record<string, unknown>]])
    }
  }

  return (
    <div className="space-y-5">
      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {k.replace(/_/g, ' ')}
              </div>
              <div className="mt-0.5 text-sm font-semibold text-lime-300">{String(v)}</div>
            </div>
          ))}
        </div>
      )}
      {tables.map(([k, rows]) => {
        const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 8)
        return (
          <div key={k}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {k.replace(/_/g, ' ')} <span className="text-slate-600">({rows.length})</span>
            </div>
            <div className="w-full overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-slate-900/80 text-left uppercase tracking-wide text-slate-500">
                  <tr>
                    {cols.map((c) => (
                      <th key={c} className="px-3 py-2 font-medium">
                        {c.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="hover:bg-slate-900/40">
                      {cols.map((c) => {
                        const cell = row[c]
                        const display =
                          cell === null || cell === undefined
                            ? '—'
                            : typeof cell === 'object'
                              ? JSON.stringify(cell)
                              : String(cell)
                        return (
                          <td key={c} className="max-w-[18rem] truncate px-3 py-2 text-slate-300" title={display}>
                            {display}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
