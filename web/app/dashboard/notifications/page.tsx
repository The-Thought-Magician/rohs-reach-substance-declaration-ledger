'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface Notification {
  id: string
  workspace_id?: string | null
  user_id?: string | null
  type?: string | null
  title: string
  body?: string | null
  link?: string | null
  is_read: boolean
  created_at?: string | null
}

type FilterMode = 'all' | 'unread' | 'read'

function timeAgo(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  const diff = Date.now() - dt.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return dt.toLocaleDateString()
}

function typeTone(type?: string | null) {
  const t = (type ?? '').toLowerCase()
  if (t.includes('fail') || t.includes('non-compliant') || t.includes('alert') || t.includes('expired'))
    return 'danger' as const
  if (t.includes('expiring') || t.includes('stale') || t.includes('reminder') || t.includes('risk'))
    return 'warning' as const
  if (t.includes('svhc') || t.includes('update') || t.includes('info')) return 'info' as const
  if (t.includes('pass') || t.includes('compliant') || t.includes('received')) return 'success' as const
  return 'neutral' as const
}

function typeIcon(type?: string | null): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('fail') || t.includes('non-compliant')) return '⛔'
  if (t.includes('expir')) return '⏳'
  if (t.includes('svhc')) return '🧪'
  if (t.includes('reminder') || t.includes('request')) return '🔔'
  if (t.includes('pass') || t.includes('compliant')) return '✅'
  return '📣'
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  function load() {
    setLoading(true)
    setError(null)
    api
      .listNotifications()
      .then((rows: Notification[]) => setItems(Array.isArray(rows) ? rows : []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const n of items) if (n.type) set.add(n.type)
    return Array.from(set).sort()
  }, [items])

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items])

  const filtered = useMemo(() => {
    return items.filter((n) => {
      if (filter === 'unread' && n.is_read) return false
      if (filter === 'read' && !n.is_read) return false
      if (typeFilter && n.type !== typeFilter) return false
      return true
    })
  }, [items, filter, typeFilter])

  async function markRead(n: Notification) {
    if (n.is_read) return
    setBusyId(n.id)
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      setError((e as Error).message)
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    if (unreadCount === 0) return
    setBulkBusy(true)
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setError((e as Error).message)
      load()
    } finally {
      setBulkBusy(false)
    }
  }

  async function remove(n: Notification) {
    setBusyId(n.id)
    try {
      await api.deleteNotification(n.id)
      setItems((prev) => prev.filter((x) => x.id !== n.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Notifications</h1>
          <p className="text-sm text-slate-500">
            Compliance alerts — failed verdicts, expiring exemptions, SVHC additions and overdue declarations.
          </p>
        </div>
        <Button onClick={markAll} disabled={bulkBusy || unreadCount === 0}>
          {bulkBusy ? <Spinner label="Marking..." /> : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total" value={items.length} />
        <Stat label="Unread" value={unreadCount} tone={unreadCount ? 'lime' : 'default'} />
        <Stat label="Read" value={items.length - unreadCount} tone="success" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1">
            {(['all', 'unread', 'read'] as FilterMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setFilter(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  filter === m ? 'bg-yellow-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-yellow-500/60 focus:outline-none"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={load} className="sm:ml-auto">
            Refresh
          </Button>
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading notifications..." />
      ) : items.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="No notifications yet. Compliance alerts will appear here as products are evaluated."
          icon="🔔"
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing here" description="No notifications match the current filter." icon="🔍" />
      ) : (
        <ul className="space-y-2">
          {filtered.map((n) => (
            <li
              key={n.id}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                n.is_read
                  ? 'border-slate-800 bg-slate-900/40'
                  : 'border-yellow-600/30 bg-yellow-500/5'
              }`}
            >
              <div className="mt-0.5 text-xl" aria-hidden>
                {typeIcon(n.type)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {!n.is_read && <span className="h-2 w-2 rounded-full bg-yellow-400" aria-label="Unread" />}
                  <span className="text-sm font-semibold text-slate-100">{n.title}</span>
                  {n.type && <Badge tone={typeTone(n.type)}>{n.type}</Badge>}
                  <span className="ml-auto whitespace-nowrap text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {n.link && (
                    <Link href={n.link} className="text-yellow-400 hover:underline">
                      View details →
                    </Link>
                  )}
                  {!n.is_read && (
                    <button
                      onClick={() => markRead(n)}
                      disabled={busyId === n.id}
                      className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => remove(n)}
                    disabled={busyId === n.id}
                    className="text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
