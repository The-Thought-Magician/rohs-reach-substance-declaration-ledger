'use client'

import { use as usePromise, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Supplier {
  id: string
  name: string
  region?: string | null
  accepted_formats?: string[] | null
  responsiveness_score?: number | null
  notes?: string | null
  created_at?: string
}

interface Scorecard {
  supplier?: Supplier
  partsSupplied?: number
  declarationsOnFile?: number
  coveragePct?: number
  passRate?: number
}

interface Contact {
  id: string
  supplier_id: string
  name: string
  email?: string | null
  role?: string | null
  is_escalation?: boolean
  created_at?: string
}

const FORMAT_OPTIONS = ['IPC-1752A', 'IEC 62474', 'Full Materials Declaration', 'PDF Certificate', 'Conflict Minerals (CMRT)']

function pct(n?: number | null): string {
  if (n == null) return '—'
  // Accept either a 0..1 fraction or an already-scaled 0..100 number.
  const v = n <= 1 ? n * 100 : n
  return `${Math.round(v)}%`
}

function fractionTone(n?: number | null): 'success' | 'warning' | 'danger' | 'default' {
  if (n == null) return 'default'
  const v = n <= 1 ? n : n / 100
  if (v >= 0.75) return 'success'
  if (v >= 0.4) return 'warning'
  return 'danger'
}

// Badge variant of the tone (no 'default' — falls back to 'neutral').
function badgeTone(n?: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  const t = fractionTone(n)
  return t === 'default' ? 'neutral' : t
}

// Simple SVG ring gauge (no chart lib).
function Gauge({ value, label }: { value?: number | null; label: string }) {
  const v = value == null ? 0 : value <= 1 ? value : value / 100
  const clamped = Math.max(0, Math.min(1, v))
  const r = 34
  const c = 2 * Math.PI * r
  const dash = clamped * c
  const tone = fractionTone(value)
  const stroke =
    tone === 'success' ? '#a3e635' : tone === 'warning' ? '#fbbf24' : tone === 'danger' ? '#f87171' : '#64748b'
  return (
    <div className="flex flex-col items-center">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="53" textAnchor="middle" className="fill-slate-100" fontSize="18" fontWeight="700">
          {value == null ? '—' : pct(value)}
        </text>
      </svg>
      <span className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  )
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params)
  const router = useRouter()

  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [scorecard, setScorecard] = useState<Scorecard | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [edit, setEdit] = useState({
    name: '',
    region: '',
    responsiveness_score: '0.5',
    notes: '',
    accepted_formats: [] as string[],
  })

  const [contactOpen, setContactOpen] = useState(false)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)
  const [contactForm, setContactForm] = useState({ name: '', email: '', role: '', is_escalation: false })
  const [deletingContact, setDeletingContact] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, sc, c] = await Promise.all([
        api.getSupplier(id),
        api.getSupplierScorecard(id).catch(() => null),
        api.listSupplierContacts(id).catch(() => []),
      ])
      setSupplier(s)
      setScorecard(sc)
      setContacts(Array.isArray(c) ? c : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load supplier')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function openEdit() {
    if (!supplier) return
    setEdit({
      name: supplier.name ?? '',
      region: supplier.region ?? '',
      responsiveness_score: String(supplier.responsiveness_score ?? 0.5),
      notes: supplier.notes ?? '',
      accepted_formats: supplier.accepted_formats ?? [],
    })
    setEditError(null)
    setEditOpen(true)
  }

  function toggleFormat(fmt: string) {
    setEdit((f) => ({
      ...f,
      accepted_formats: f.accepted_formats.includes(fmt)
        ? f.accepted_formats.filter((x) => x !== fmt)
        : [...f.accepted_formats, fmt],
    }))
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!edit.name.trim()) {
      setEditError('Name is required')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      const score = parseFloat(edit.responsiveness_score)
      const updated = await api.updateSupplier(id, {
        name: edit.name.trim(),
        region: edit.region.trim() || null,
        accepted_formats: edit.accepted_formats,
        responsiveness_score: Number.isFinite(score) ? score : 0.5,
        notes: edit.notes.trim() || null,
      })
      setSupplier(updated)
      setEditOpen(false)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to update supplier')
    } finally {
      setSaving(false)
    }
  }

  async function submitContact(e: React.FormEvent) {
    e.preventDefault()
    if (!contactForm.name.trim()) {
      setContactError('Contact name is required')
      return
    }
    setContactSaving(true)
    setContactError(null)
    try {
      const created = await api.addSupplierContact(id, {
        name: contactForm.name.trim(),
        email: contactForm.email.trim() || null,
        role: contactForm.role.trim() || null,
        is_escalation: contactForm.is_escalation,
      })
      setContacts((prev) => [...prev, created])
      setContactForm({ name: '', email: '', role: '', is_escalation: false })
      setContactOpen(false)
    } catch (e) {
      setContactError(e instanceof Error ? e.message : 'Failed to add contact')
    } finally {
      setContactSaving(false)
    }
  }

  async function deleteContact(contactId: string) {
    setDeletingContact(contactId)
    try {
      await api.deleteSupplierContact(id, contactId)
      setContacts((prev) => prev.filter((c) => c.id !== contactId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete contact')
    } finally {
      setDeletingContact(null)
    }
  }

  if (loading) return <PageSpinner label="Loading supplier…" />

  if (error || !supplier) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/suppliers" className="text-sm text-slate-400 hover:text-yellow-400">
          ← Back to suppliers
        </Link>
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-red-300">{error ?? 'Supplier not found'}</p>
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/suppliers" className="text-sm text-slate-400 hover:text-yellow-400">
        ← Back to suppliers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{supplier.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            {supplier.region && <Badge tone="info">{supplier.region}</Badge>}
            <Badge tone={badgeTone(supplier.responsiveness_score)}>
              Responsiveness {pct(supplier.responsiveness_score)}
            </Badge>
            {(supplier.accepted_formats ?? []).map((f) => (
              <Badge key={f} tone="neutral">
                {f}
              </Badge>
            ))}
          </div>
        </div>
        <Button variant="secondary" onClick={openEdit}>
          Edit supplier
        </Button>
      </div>

      {supplier.notes && (
        <Card>
          <CardBody>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{supplier.notes}</p>
          </CardBody>
        </Card>
      )}

      {/* Scorecard */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Scorecard</h2>
          <span className="text-xs text-slate-500">Declaration coverage & quality</span>
        </CardHeader>
        <CardBody>
          {scorecard ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Parts supplied" value={scorecard.partsSupplied ?? 0} tone="lime" />
                <Stat label="Declarations on file" value={scorecard.declarationsOnFile ?? 0} />
                <Stat
                  label="Coverage"
                  value={pct(scorecard.coveragePct)}
                  tone={fractionTone(scorecard.coveragePct) === 'default' ? 'default' : fractionTone(scorecard.coveragePct)}
                />
                <Stat
                  label="Pass rate"
                  value={pct(scorecard.passRate)}
                  tone={fractionTone(scorecard.passRate) === 'default' ? 'default' : fractionTone(scorecard.passRate)}
                />
              </div>
              <div className="flex items-center justify-around rounded-xl border border-slate-800 bg-slate-950/40 py-4">
                <Gauge value={scorecard.coveragePct} label="Coverage" />
                <Gauge value={scorecard.passRate} label="Pass rate" />
                <Gauge value={supplier.responsiveness_score} label="Response" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Scorecard data is not available for this supplier yet.</p>
          )}
        </CardBody>
      </Card>

      {/* Contacts */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Contacts</h2>
          <Button size="sm" onClick={() => setContactOpen(true)}>
            + Add contact
          </Button>
        </CardHeader>
        <CardBody>
          {contacts.length === 0 ? (
            <EmptyState
              icon="📇"
              title="No contacts"
              description="Add the people you reach for declarations and escalations."
              action={
                <Button size="sm" onClick={() => setContactOpen(true)}>
                  + Add contact
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Escalation</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {contacts.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-100">{c.name}</TD>
                    <TD>
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="text-yellow-400 hover:underline">
                          {c.email}
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD>{c.role || <span className="text-slate-600">—</span>}</TD>
                    <TD>{c.is_escalation ? <Badge tone="warning">Escalation</Badge> : <span className="text-slate-600">—</span>}</TD>
                    <TD className="text-right">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => deleteContact(c.id)}
                        disabled={deletingContact === c.id}
                      >
                        {deletingContact === c.id ? '…' : 'Remove'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title="Edit supplier"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="edit-supplier-form" disabled={saving}>
              {saving ? <Spinner label="Saving…" /> : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="edit-supplier-form" onSubmit={submitEdit} className="space-y-4">
          {editError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {editError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Name</label>
            <input
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Region</label>
            <input
              value={edit.region}
              onChange={(e) => setEdit({ ...edit, region: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Responsiveness score ({pct(parseFloat(edit.responsiveness_score))})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={edit.responsiveness_score}
              onChange={(e) => setEdit({ ...edit, responsiveness_score: e.target.value })}
              className="w-full accent-yellow-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Accepted declaration formats
            </label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((fmt) => {
                const active = edit.accepted_formats.includes(fmt)
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => toggleFormat(fmt)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? 'border-yellow-600/40 bg-yellow-500/15 text-yellow-300'
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
              value={edit.notes}
              onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-yellow-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      {/* Add contact modal */}
      <Modal
        open={contactOpen}
        onClose={() => !contactSaving && setContactOpen(false)}
        title="Add contact"
        footer={
          <>
            <Button variant="ghost" onClick={() => setContactOpen(false)} disabled={contactSaving}>
              Cancel
            </Button>
            <Button type="submit" form="add-contact-form" disabled={contactSaving}>
              {contactSaving ? <Spinner label="Saving…" /> : 'Add contact'}
            </Button>
          </>
        }
      >
        <form id="add-contact-form" onSubmit={submitContact} className="space-y-4">
          {contactError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {contactError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Name</label>
            <input
              value={contactForm.name}
              onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-yellow-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Email</label>
            <input
              type="email"
              value={contactForm.email}
              onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Role</label>
            <input
              value={contactForm.role}
              onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
              placeholder="Compliance manager, Sales rep…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={contactForm.is_escalation}
              onChange={(e) => setContactForm({ ...contactForm, is_escalation: e.target.checked })}
              className="h-4 w-4 accent-yellow-500"
            />
            Escalation contact
          </label>
        </form>
      </Modal>
    </div>
  )
}
