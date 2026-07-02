'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Spinner, PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  company?: string | null
  market_regions?: string[] | null
  default_thresholds?: Record<string, number> | null
  owner_id?: string
  created_at?: string
  updated_at?: string
}

interface Member {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at?: string
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id?: string
  status?: string
  current_period_end?: string | null
}

interface BillingInfo {
  subscription: Subscription | null
  plan: Plan | null
  stripeEnabled?: boolean
}

interface SeedStatus {
  seeded: boolean
  counts?: Record<string, number>
}

const REGION_OPTIONS = ['EU', 'UK', 'China', 'North America', 'California (Prop 65)', 'Japan', 'South Korea']
const ROLE_OPTIONS = ['admin', 'editor', 'viewer']
const THRESHOLD_KEYS = [
  { key: 'rohs_ppm', label: 'RoHS limit (ppm)', placeholder: '1000' },
  { key: 'svhc_ppm', label: 'SVHC article threshold (ppm)', placeholder: '1000' },
]

function fmtPrice(cents?: number): string {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}/mo`
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [seedStatus, setSeedStatus] = useState<SeedStatus | null>(null)

  // Workspace settings form
  const [wsForm, setWsForm] = useState({
    name: '',
    company: '',
    market_regions: [] as string[],
    rohs_ppm: '',
    svhc_ppm: '',
  })
  const [savingWs, setSavingWs] = useState(false)
  const [wsMsg, setWsMsg] = useState<string | null>(null)
  const [wsError, setWsError] = useState<string | null>(null)

  // Member management
  const [addOpen, setAddOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'editor' })
  const [savingMember, setSavingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [removingMember, setRemovingMember] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null)

  // Billing actions
  const [billingBusy, setBillingBusy] = useState<'checkout' | 'portal' | null>(null)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  // Seeder
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)

  function hydrateWsForm(ws: Workspace) {
    const t = ws.default_thresholds ?? {}
    setWsForm({
      name: ws.name ?? '',
      company: ws.company ?? '',
      market_regions: Array.isArray(ws.market_regions) ? ws.market_regions : [],
      rohs_ppm: t.rohs_ppm != null ? String(t.rohs_ppm) : '',
      svhc_ppm: t.svhc_ppm != null ? String(t.svhc_ppm) : '',
    })
  }

  async function loadMembers(wsId: string) {
    try {
      const data = await api.listMembers(wsId)
      setMembers(Array.isArray(data) ? data : [])
    } catch {
      setMembers([])
    }
  }

  async function loadSeedStatus(wsId?: string) {
    try {
      const data = await api.getSeedStatus(wsId)
      setSeedStatus(data ?? null)
    } catch {
      setSeedStatus(null)
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      // Billing is user-scoped and independent of any workspace.
      const billingData = await api.getBillingPlan().catch(() => null)
      setBilling(billingData)

      const wss = await api.listWorkspaces()
      const list: Workspace[] = Array.isArray(wss) ? wss : []
      if (list.length) {
        const ws = list[0]
        setWorkspaceId(ws.id)
        // Re-fetch full detail in case the list view is trimmed.
        const detail = await api.getWorkspace(ws.id).catch(() => ws)
        const full = (detail as Workspace) ?? ws
        setWorkspace(full)
        hydrateWsForm(full)
        await Promise.all([loadMembers(ws.id), loadSeedStatus(ws.id)])
      } else {
        setWorkspace(null)
        setWorkspaceId(null)
        await loadSeedStatus(undefined)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function toggleRegion(r: string) {
    setWsForm((f) => ({
      ...f,
      market_regions: f.market_regions.includes(r)
        ? f.market_regions.filter((x) => x !== r)
        : [...f.market_regions, r],
    }))
  }

  async function submitWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    if (!wsForm.name.trim()) {
      setWsError('Workspace name is required')
      return
    }
    setSavingWs(true)
    setWsError(null)
    setWsMsg(null)
    try {
      const thresholds: Record<string, number> = {}
      const rohs = parseFloat(wsForm.rohs_ppm)
      const svhc = parseFloat(wsForm.svhc_ppm)
      if (Number.isFinite(rohs)) thresholds.rohs_ppm = rohs
      if (Number.isFinite(svhc)) thresholds.svhc_ppm = svhc
      const updated = await api.updateWorkspace(workspaceId, {
        name: wsForm.name.trim(),
        company: wsForm.company.trim() || null,
        market_regions: wsForm.market_regions,
        default_thresholds: thresholds,
      })
      const full = (updated as Workspace) ?? null
      if (full) {
        setWorkspace(full)
        hydrateWsForm(full)
      }
      setWsMsg('Workspace settings saved')
    } catch (e) {
      setWsError(e instanceof Error ? e.message : 'Failed to save workspace')
    } finally {
      setSavingWs(false)
    }
  }

  async function submitAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    if (!memberForm.user_id.trim()) {
      setMemberError('A user ID is required')
      return
    }
    setSavingMember(true)
    setMemberError(null)
    try {
      await api.addMember(workspaceId, {
        user_id: memberForm.user_id.trim(),
        role: memberForm.role,
      })
      setAddOpen(false)
      setMemberForm({ user_id: '', role: 'editor' })
      await loadMembers(workspaceId)
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to add member')
    } finally {
      setSavingMember(false)
    }
  }

  async function doRemoveMember(m: Member) {
    if (!workspaceId) return
    setRemovingMember(m.id)
    try {
      await api.removeMember(workspaceId, m.id)
      setConfirmRemove(null)
      setMembers((prev) => prev.filter((x) => x.id !== m.id))
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setRemovingMember(null)
    }
  }

  async function doCheckout() {
    setBillingBusy('checkout')
    setBillingMsg(null)
    try {
      const res = await api.startCheckout()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Checkout is not available right now.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Billing is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(null)
    }
  }

  async function doPortal() {
    setBillingBusy('portal')
    setBillingMsg(null)
    try {
      const res = await api.openPortal()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Billing portal is not available right now.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Billing is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(null)
    }
  }

  async function doSeed() {
    setSeeding(true)
    setSeedMsg(null)
    setSeedError(null)
    try {
      const res = await api.seedSampleData()
      setSeedMsg('Sample data seeded successfully.')
      // After seeding, reload the whole page state so the new workspace appears.
      if (res?.workspace_id) {
        setWorkspaceId(res.workspace_id)
      }
      await load()
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  const planName = billing?.plan?.name ?? billing?.subscription?.plan_id ?? 'Free'
  const subStatus = billing?.subscription?.status ?? 'free'
  const isPro = (billing?.plan?.id ?? billing?.subscription?.plan_id) === 'pro'
  const stripeEnabled = billing?.stripeEnabled ?? false

  const seedCounts = useMemo(() => {
    const c = seedStatus?.counts ?? {}
    return Object.entries(c).filter(([, v]) => typeof v === 'number')
  }, [seedStatus])

  if (loading) return <PageSpinner label="Loading settings…" />

  if (error) {
    return (
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
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your workspace, market regions, default compliance thresholds, members, billing, and sample data.
        </p>
      </div>

      {/* ---------------- Workspace ---------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Workspace</h2>
        {!workspace ? (
          <EmptyState
            icon="🗂️"
            title="No workspace yet"
            description="Seed sample data below to create your first workspace with products, BOMs, suppliers, and regulatory lists."
            action={
              <Button onClick={doSeed} disabled={seeding}>
                {seeding ? <Spinner label="Seeding…" /> : 'Seed sample workspace'}
              </Button>
            }
          />
        ) : (
          <Card>
            <CardBody>
              <form onSubmit={submitWorkspace} className="space-y-5">
                {wsError && (
                  <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {wsError}
                  </div>
                )}
                {wsMsg && (
                  <div className="rounded-lg border border-yellow-600/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                    {wsMsg}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Workspace name
                    </label>
                    <input
                      value={wsForm.name}
                      onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
                      placeholder="Compliance Workspace"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-yellow-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Company
                    </label>
                    <input
                      value={wsForm.company}
                      onChange={(e) => setWsForm({ ...wsForm, company: e.target.value })}
                      placeholder="Acme Hardware Inc."
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-yellow-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Market regions
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {REGION_OPTIONS.map((r) => {
                      const active = wsForm.market_regions.includes(r)
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => toggleRegion(r)}
                          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            active
                              ? 'border-yellow-600/40 bg-yellow-500/15 text-yellow-300'
                              : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {r}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
                    Default compliance thresholds
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {THRESHOLD_KEYS.map((t) => (
                      <div key={t.key}>
                        <label className="mb-1 block text-[11px] text-slate-500">{t.label}</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={wsForm[t.key as 'rohs_ppm' | 'svhc_ppm']}
                          onChange={(e) => setWsForm({ ...wsForm, [t.key]: e.target.value })}
                          placeholder={t.placeholder}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-yellow-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    1000 ppm = 0.1%. Used as the default RoHS homogeneous-material limit and the REACH SVHC article
                    notification threshold when a substance has no explicit limit.
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <Button type="submit" disabled={savingWs}>
                    {savingWs ? <Spinner label="Saving…" /> : 'Save workspace'}
                  </Button>
                  <span className="text-xs text-slate-600">
                    Created {fmtDate(workspace.created_at)} · ID {workspace.id}
                  </span>
                </div>
              </form>
            </CardBody>
          </Card>
        )}
      </section>

      {/* ---------------- Members ---------------- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Members</h2>
          {workspace && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              + Add member
            </Button>
          )}
        </div>

        {memberError && (
          <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {memberError}
          </div>
        )}

        {!workspace ? (
          <Card>
            <CardBody className="text-sm text-slate-500">Create a workspace to manage members.</CardBody>
          </Card>
        ) : members.length === 0 ? (
          <EmptyState
            icon="👤"
            title="No members yet"
            description="Invite teammates by their user ID to collaborate on this workspace."
            action={<Button size="sm" onClick={() => setAddOpen(true)}>+ Add member</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Added</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {members.map((m) => {
                const isOwner = workspace?.owner_id && m.user_id === workspace.owner_id
                return (
                  <TR key={m.id}>
                    <TD>
                      <span className="font-medium text-slate-100">{m.user_id}</span>
                      {isOwner && (
                        <Badge tone="lime" className="ml-2">
                          Owner
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={m.role === 'admin' ? 'info' : 'neutral'}>{m.role}</Badge>
                    </TD>
                    <TD>{fmtDate(m.created_at)}</TD>
                    <TD className="text-right">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={!!isOwner || removingMember === m.id}
                        onClick={() => setConfirmRemove(m)}
                      >
                        {removingMember === m.id ? '…' : isOwner ? 'Owner' : 'Remove'}
                      </Button>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </section>

      {/* ---------------- Billing ---------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Billing</h2>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold text-slate-100">{planName}</span>
              <Badge tone={statusTone(subStatus)}>{subStatus}</Badge>
              {!stripeEnabled && <Badge tone="warning">Stripe disabled</Badge>}
            </div>
            <div className="flex gap-2">
              {!isPro && (
                <Button size="sm" onClick={doCheckout} disabled={billingBusy !== null || !stripeEnabled}>
                  {billingBusy === 'checkout' ? <Spinner label="Redirecting…" /> : 'Upgrade to Pro'}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={doPortal}
                disabled={billingBusy !== null || !stripeEnabled}
              >
                {billingBusy === 'portal' ? <Spinner label="Opening…" /> : 'Manage billing'}
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Plan" value={planName} tone={isPro ? 'lime' : 'default'} />
              <Stat label="Price" value={fmtPrice(billing?.plan?.price_cents)} />
              <Stat
                label="Renews"
                value={fmtDate(billing?.subscription?.current_period_end)}
                hint={isPro ? 'Current period end' : 'No active subscription'}
              />
            </div>
            {!stripeEnabled && (
              <p className="text-xs text-slate-600">
                Stripe is not configured on this deployment, so checkout and portal links are unavailable. Set the
                Stripe keys on the backend to enable paid plans.
              </p>
            )}
            {billingMsg && (
              <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                {billingMsg}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* ---------------- Sample data ---------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Sample data</h2>
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-200">Demo workspace seeder</span>
                  {seedStatus?.seeded ? (
                    <Badge tone="success">Seeded</Badge>
                  ) : (
                    <Badge tone="neutral">Not seeded</Badge>
                  )}
                </div>
                <p className="mt-1 max-w-xl text-xs text-slate-500">
                  Populate this account with products, BOMs, suppliers, declarations, the RoHS restricted-substance
                  catalog, an SVHC list, and exemptions. Includes a deliberately non-compliant product so you can see the
                  compliance engine flag a violation.
                </p>
              </div>
              <Button onClick={doSeed} disabled={seeding}>
                {seeding ? <Spinner label="Seeding…" /> : seedStatus?.seeded ? 'Re-seed sample data' : 'Seed sample data'}
              </Button>
            </div>

            {seedError && (
              <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {seedError}
              </div>
            )}
            {seedMsg && (
              <div className="rounded-lg border border-yellow-600/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                {seedMsg}
              </div>
            )}

            {seedCounts.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {seedCounts.map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="text-xs capitalize text-slate-500">{k.replace(/_/g, ' ')}</div>
                    <div className="text-lg font-semibold text-slate-100">{v}</div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* ---------------- Add member modal ---------------- */}
      <Modal
        open={addOpen}
        onClose={() => !savingMember && setAddOpen(false)}
        title="Add member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={savingMember}>
              Cancel
            </Button>
            <Button type="submit" form="add-member-form" disabled={savingMember}>
              {savingMember ? <Spinner label="Adding…" /> : 'Add member'}
            </Button>
          </>
        }
      >
        <form id="add-member-form" onSubmit={submitAddMember} className="space-y-4">
          {memberError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {memberError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">User ID</label>
            <input
              value={memberForm.user_id}
              onChange={(e) => setMemberForm({ ...memberForm, user_id: e.target.value })}
              placeholder="user_abc123"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-yellow-500 focus:outline-none"
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-600">The teammate&apos;s Neon Auth user ID.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Role</label>
            <select
              value={memberForm.role}
              onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-yellow-500 focus:outline-none"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal>

      {/* ---------------- Remove member modal ---------------- */}
      <Modal
        open={!!confirmRemove}
        onClose={() => !removingMember && setConfirmRemove(null)}
        title="Remove member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)} disabled={!!removingMember}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmRemove && doRemoveMember(confirmRemove)}
              disabled={!!removingMember}
            >
              {removingMember ? <Spinner label="Removing…" /> : 'Remove'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Remove <span className="font-semibold text-slate-100">{confirmRemove?.user_id}</span> from this workspace?
          They will lose access to its products and declarations.
        </p>
      </Modal>
    </div>
  )
}
