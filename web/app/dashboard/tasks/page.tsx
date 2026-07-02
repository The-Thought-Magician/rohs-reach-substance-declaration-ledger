'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api, { getActiveWorkspaceId } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface Task {
  id: string
  workspace_id?: string | null
  product_id?: string | null
  component_id?: string | null
  title: string
  description?: string | null
  status: string
  assignee_id?: string | null
  due_date?: string | null
  offending_substance?: string | null
  created_at?: string | null
}

const COLUMNS: { key: string; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
]

const STATUS_OPTIONS = COLUMNS.map((c) => c.key)

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString()
}

function isOverdue(d?: string | null): boolean {
  if (!d) return false
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return false
  return dt.getTime() < Date.now()
}

interface FormState {
  title: string
  description: string
  status: string
  assignee_id: string
  due_date: string
  offending_substance: string
}

const emptyForm: FormState = {
  title: '',
  description: '',
  status: 'open',
  assignee_id: '',
  due_date: '',
  offending_substance: '',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [query, setQuery] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [detail, setDetail] = useState<Task | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [wsId, setWsId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const id = await getActiveWorkspaceId()
    if (!id) {
      setNoWorkspace(true)
      setLoading(false)
      return
    }
    setWsId(id)
    api
      .listTasks({ workspace_id: id, status: statusFilter || undefined })
      .then((rows: Task[]) => setTasks(Array.isArray(rows) ? rows : []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.offending_substance?.toLowerCase().includes(q),
    )
  }, [tasks, query])

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const c of COLUMNS) map[c.key] = []
    for (const t of filtered) {
      const k = STATUS_OPTIONS.includes(t.status) ? t.status : 'open'
      map[k].push(t)
    }
    return map
  }, [filtered])

  const counts = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'done').length
    const done = tasks.filter((t) => t.status === 'done').length
    const overdue = tasks.filter((t) => t.status !== 'done' && isOverdue(t.due_date)).length
    return { total: tasks.length, open, done, overdue }
  }, [tasks])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(t: Task) {
    setEditing(t)
    setForm({
      title: t.title ?? '',
      description: t.description ?? '',
      status: t.status ?? 'open',
      assignee_id: t.assignee_id ?? '',
      due_date: t.due_date ? t.due_date.slice(0, 10) : '',
      offending_substance: t.offending_substance ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) {
      setFormError('Title is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    const body: Record<string, unknown> = {
      workspace_id: wsId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      assignee_id: form.assignee_id.trim() || null,
      due_date: form.due_date || null,
      offending_substance: form.offending_substance.trim() || null,
    }
    try {
      if (editing) {
        await api.updateTask(editing.id, body)
      } else {
        await api.createTask(body)
      }
      setModalOpen(false)
      load()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function moveTask(t: Task, status: string) {
    if (t.status === status) return
    setBusyId(t.id)
    // Optimistic update.
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status } : x)))
    try {
      await api.updateTask(t.id, { status })
    } catch (e) {
      setError((e as Error).message)
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(t: Task) {
    if (!confirm(`Delete task "${t.title}"?`)) return
    setBusyId(t.id)
    try {
      await api.deleteTask(t.id)
      setTasks((prev) => prev.filter((x) => x.id !== t.id))
      if (detail?.id === t.id) setDetail(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function openDetail(t: Task) {
    setDetailLoading(true)
    setDetail(t)
    try {
      const full: Task = await api.getTask(t.id)
      if (full) setDetail(full)
    } catch {
      // Keep the row-level data if detail fetch fails.
    } finally {
      setDetailLoading(false)
    }
  }

  if (noWorkspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-100">Remediation Tasks</h1>
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings before tracking tasks."
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Remediation Tasks</h1>
          <p className="text-sm text-slate-500">
            Track compliance follow-ups — chase declarations, swap non-compliant parts, file exemptions.
          </p>
        </div>
        <Button onClick={openCreate}>New task</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total" value={counts.total} />
        <Stat label="Open" value={counts.open} tone="lime" />
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? 'danger' : 'default'} />
        <Stat label="Done" value={counts.done} tone="success" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-lime-500/60 focus:outline-none sm:max-w-xs"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-lime-500/60 focus:outline-none"
          >
            <option value="">All statuses</option>
            {COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {statusFilter && (
            <Button variant="ghost" size="sm" onClick={() => setStatusFilter('')}>
              Clear filter
            </Button>
          )}
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading tasks..." />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Create a remediation task to start tracking compliance follow-ups."
          icon="✅"
          action={<Button onClick={openCreate}>New task</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <span className="text-sm font-semibold text-slate-200">{col.label}</span>
                <Badge tone={statusTone(col.key)}>{byStatus[col.key].length}</Badge>
              </div>
              <div className="flex min-h-[120px] flex-col gap-2 p-3">
                {byStatus[col.key].length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-600">No tasks</p>
                ) : (
                  byStatus[col.key].map((t) => {
                    const overdue = t.status !== 'done' && isOverdue(t.due_date)
                    return (
                      <div
                        key={t.id}
                        className="group rounded-lg border border-slate-800 bg-slate-900 p-3 transition-colors hover:border-slate-700"
                      >
                        <button
                          onClick={() => openDetail(t)}
                          className="block w-full text-left text-sm font-medium text-slate-200 hover:text-lime-300"
                        >
                          {t.title}
                        </button>
                        {t.offending_substance && (
                          <div className="mt-1.5">
                            <Badge tone="danger">{t.offending_substance}</Badge>
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {t.due_date && (
                            <span className={overdue ? 'font-medium text-red-400' : ''}>
                              Due {fmtDate(t.due_date)}
                            </span>
                          )}
                          {t.assignee_id && <span>· {t.assignee_id}</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <select
                            value={t.status}
                            disabled={busyId === t.id}
                            onChange={(e) => moveTask(t, e.target.value)}
                            className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-300 focus:border-lime-500/60 focus:outline-none"
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(t)}
                            disabled={busyId === t.id}
                            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit task' : 'New task'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : editing ? 'Save changes' : 'Create task'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input"
              placeholder="Replace leaded solder on RF board"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="input"
              placeholder="Details, links, context..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="input"
              >
                {COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="input"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee">
              <input
                value={form.assignee_id}
                onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                className="input"
                placeholder="User id / email"
              />
            </Field>
            <Field label="Offending substance">
              <input
                value={form.offending_substance}
                onChange={(e) => setForm({ ...form, offending_substance: e.target.value })}
                className="input"
                placeholder="e.g. Lead (Pb)"
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title}
        footer={
          detail && (
            <>
              <Button
                variant="danger"
                onClick={() => detail && handleDelete(detail)}
                disabled={busyId === detail.id}
              >
                Delete
              </Button>
              <Button
                onClick={() => {
                  if (detail) {
                    openEdit(detail)
                    setDetail(null)
                  }
                }}
              >
                Edit
              </Button>
            </>
          )
        }
      >
        {detailLoading && (
          <div className="mb-3">
            <Spinner label="Loading..." />
          </div>
        )}
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
              {detail.offending_substance && <Badge tone="danger">{detail.offending_substance}</Badge>}
              {detail.status !== 'done' && isOverdue(detail.due_date) && <Badge tone="danger">Overdue</Badge>}
            </div>
            {detail.description && <p className="text-slate-300">{detail.description}</p>}
            <dl className="grid grid-cols-2 gap-3 text-slate-400">
              <Meta label="Due date" value={fmtDate(detail.due_date)} />
              <Meta label="Assignee" value={detail.assignee_id ?? '—'} />
              <Meta label="Product" value={detail.product_id ?? '—'} />
              <Meta label="Component" value={detail.component_id ?? '—'} />
              <Meta label="Created" value={fmtDate(detail.created_at)} />
            </dl>
          </div>
        )}
      </Modal>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(51 65 85);
          background: rgb(2 6 23);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(226 232 240);
        }
        :global(.input:focus) {
          outline: none;
          border-color: rgba(132, 204, 22, 0.6);
        }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className="mt-0.5 text-slate-300">{value}</dd>
    </div>
  )
}
