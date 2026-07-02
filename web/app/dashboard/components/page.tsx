'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api, { getActiveWorkspaceId } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Component {
  id: string
  name: string
  manufacturer_part_number?: string | null
  description?: string | null
  supplier_id?: string | null
  manufacturer?: string | null
  mass_grams?: number | null
  created_at?: string
}

interface Supplier {
  id: string
  name: string
  region?: string | null
}

const emptyForm = {
  name: '',
  manufacturer_part_number: '',
  manufacturer: '',
  description: '',
  supplier_id: '',
  mass_grams: '',
}

export default function ComponentCatalogPage() {
  const [components, setComponents] = useState<Component[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [casFilter, setCasFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const supplierName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of suppliers) m.set(s.id, s.name)
    return m
  }, [suppliers])

  async function load(params?: { supplier_id?: string; substance_cas?: string }) {
    setLoading(true)
    setError(null)
    try {
      const wsId = await getActiveWorkspaceId()
      if (!wsId) {
        setNoWorkspace(true)
        return
      }
      const [comps, sups] = await Promise.all([
        api.listComponents({
          workspace_id: wsId,
          supplier_id: params?.supplier_id || undefined,
          substance_cas: params?.substance_cas || undefined,
        }),
        api.listSuppliers(wsId),
      ])
      setComponents(Array.isArray(comps) ? comps : [])
      setSuppliers(Array.isArray(sups) ? sups : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load components')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyServerFilters() {
    load({ supplier_id: supplierFilter, substance_cas: casFilter })
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return components
    return components.filter((c) =>
      [c.name, c.manufacturer_part_number, c.manufacturer, c.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [components, search])

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const wsId = await getActiveWorkspaceId()
      if (!wsId) throw new Error('No workspace found')
      const body: Record<string, unknown> = {
        workspace_id: wsId,
        name: form.name.trim(),
        manufacturer_part_number: form.manufacturer_part_number.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        description: form.description.trim() || null,
        supplier_id: form.supplier_id || null,
      }
      if (form.mass_grams !== '') body.mass_grams = Number(form.mass_grams)
      await api.createComponent(body)
      setCreateOpen(false)
      setForm(emptyForm)
      await load({ supplier_id: supplierFilter, substance_cas: casFilter })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create component')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this component? This also removes its materials and substance data.')) return
    setDeletingId(id)
    try {
      await api.deleteComponent(id)
      setComponents((prev) => prev.filter((c) => c.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete component')
    } finally {
      setDeletingId(null)
    }
  }

  const totalMass = useMemo(
    () => components.reduce((acc, c) => acc + (Number(c.mass_grams) || 0), 0),
    [components],
  )
  const distinctSuppliers = useMemo(
    () => new Set(components.map((c) => c.supplier_id).filter(Boolean)).size,
    [components],
  )

  if (noWorkspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-100">Component Catalog</h1>
        <EmptyState
          title="No workspace yet"
          description="Create a workspace in Settings before adding components."
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
          <h1 className="text-2xl font-bold text-slate-100">Component Catalog</h1>
          <p className="mt-1 text-sm text-slate-500">
            Parts in your supply chain, their materials, and substance composition.
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setFormError(null); setCreateOpen(true) }}>
          + New component
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Components" value={components.length} tone="lime" />
        <Stat label="Suppliers referenced" value={distinctSuppliers} />
        <Stat label="Total catalog mass" value={`${totalMass.toFixed(1)} g`} />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Search
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, MPN, manufacturer..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div className="w-full lg:w-56">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Supplier
            </label>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-yellow-500 focus:outline-none"
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-48">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Contains CAS #
            </label>
            <input
              value={casFilter}
              onChange={(e) => setCasFilter(e.target.value)}
              placeholder="e.g. 7439-92-1"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={applyServerFilters}>
              Apply
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('')
                setSupplierFilter('')
                setCasFilter('')
                load()
              }}
            >
              Reset
            </Button>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner label="Loading catalog..." />
      ) : error ? (
        <Card>
          <CardBody>
            <div className="text-sm text-red-300">{error}</div>
            <Button variant="secondary" className="mt-3" onClick={() => load()}>
              Retry
            </Button>
          </CardBody>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No components found"
          description={
            components.length === 0
              ? 'Add a component to start tracking its materials and restricted-substance exposure.'
              : 'No components match your current filters.'
          }
          action={
            components.length === 0 ? (
              <Button onClick={() => setCreateOpen(true)}>+ New component</Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Component</TH>
              <TH>MPN</TH>
              <TH>Manufacturer</TH>
              <TH>Supplier</TH>
              <TH className="text-right">Mass</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link
                    href={`/dashboard/components/${c.id}`}
                    className="font-medium text-slate-100 hover:text-yellow-400"
                  >
                    {c.name}
                  </Link>
                  {c.description && (
                    <div className="mt-0.5 max-w-md truncate text-xs text-slate-500">{c.description}</div>
                  )}
                </TD>
                <TD className="font-mono text-xs">{c.manufacturer_part_number || '—'}</TD>
                <TD>{c.manufacturer || '—'}</TD>
                <TD>
                  {c.supplier_id ? (
                    <Badge tone="info">{supplierName.get(c.supplier_id) || 'Unknown'}</Badge>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums">
                  {c.mass_grams != null ? `${Number(c.mass_grams).toFixed(2)} g` : '—'}
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/components/${c.id}`}>
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={deletingId === c.id}
                      onClick={() => remove(c.id)}
                    >
                      {deletingId === c.id ? '...' : 'Delete'}
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
        onClose={() => setCreateOpen(false)}
        title="New component"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="component-create-form" disabled={saving || !form.name.trim()}>
              {saving ? 'Creating...' : 'Create component'}
            </Button>
          </>
        }
      >
        <form id="component-create-form" onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Name" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Manufacturer part number">
              <input
                value={form.manufacturer_part_number}
                onChange={(e) => setForm({ ...form, manufacturer_part_number: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Manufacturer">
              <input
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Supplier">
              <select
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Unassigned</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mass (grams)">
              <input
                type="number"
                step="any"
                min="0"
                value={form.mass_grams}
                onChange={(e) => setForm({ ...form, mass_grams: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className={inputCls}
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-yellow-500 focus:outline-none'

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="ml-0.5 text-yellow-400">*</span>}
      </span>
      {children}
    </label>
  )
}
