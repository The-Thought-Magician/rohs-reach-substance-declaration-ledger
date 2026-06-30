'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Product {
  id: string
  name: string
  sku?: string
  part_number?: string
  category?: string
  market_region?: string
  lifecycle_status?: string
  compliance_status?: string
  created_at?: string
  updated_at?: string
}

const STATUS_FILTERS = ['all', 'compliant', 'non-compliant', 'at-risk', 'incomplete'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const emptyForm = {
  name: '',
  sku: '',
  part_number: '',
  category: '',
  market_region: 'EU',
  lifecycle_status: 'active',
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listProducts()
      setProducts(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (statusFilter !== 'all') {
        const norm = (p.compliance_status ?? '').toLowerCase().replace(/[_\s]+/g, '-')
        if (statusFilter === 'incomplete') {
          if (norm !== 'incomplete' && norm !== 'incomplete-data') return false
        } else if (norm !== statusFilter) {
          return false
        }
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.part_number ?? '').toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, search, statusFilter])

  const counts = useMemo(() => {
    const c = { compliant: 0, nonCompliant: 0, atRisk: 0, incomplete: 0 }
    for (const p of products) {
      const n = (p.compliance_status ?? '').toLowerCase().replace(/[_\s]+/g, '-')
      if (n === 'compliant') c.compliant++
      else if (n === 'non-compliant') c.nonCompliant++
      else if (n === 'at-risk') c.atRisk++
      else c.incomplete++
    }
    return c
  }, [products])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createProduct({
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        part_number: form.part_number.trim() || undefined,
        category: form.category.trim() || undefined,
        market_region: form.market_region.trim() || undefined,
        lifecycle_status: form.lifecycle_status.trim() || undefined,
      })
      setCreateOpen(false)
      setForm({ ...emptyForm })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create product')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteProduct(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete product')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Products</h1>
          <p className="text-sm text-slate-500">Every product in your portfolio with its roll-up compliance verdict</p>
        </div>
        <Button onClick={() => { setForm({ ...emptyForm }); setFormError(null); setCreateOpen(true) }}>
          + New product
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Compliant" value={counts.compliant} tone="success" />
        <Stat label="Non-compliant" value={counts.nonCompliant} tone="danger" />
        <Stat label="At risk" value={counts.atRisk} tone="warning" />
        <Stat label="Incomplete" value={counts.incomplete} tone="default" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-lime-500/15 text-lime-300 ring-1 ring-inset ring-lime-600/40'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU, part #..."
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600"
          />
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <PageSpinner label="Loading products..." />
          ) : error ? (
            <EmptyState
              className="m-4"
              title="Could not load products"
              description={error}
              action={<Button variant="secondary" onClick={load}>Retry</Button>}
            />
          ) : products.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No products yet"
              description="Create your first product to start tracking RoHS and REACH compliance."
              action={<Button onClick={() => setCreateOpen(true)}>+ New product</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No matches"
              description="No products match the current filter and search."
              action={
                <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all') }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU / Part #</TH>
                  <TH>Category</TH>
                  <TH>Region</TH>
                  <TH>Lifecycle</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/dashboard/products/${p.id}`} className="font-medium text-slate-100 hover:text-lime-300">
                        {p.name}
                      </Link>
                    </TD>
                    <TD className="text-slate-400">
                      <div>{p.sku ?? '—'}</div>
                      {p.part_number && <div className="text-xs text-slate-600">{p.part_number}</div>}
                    </TD>
                    <TD className="text-slate-400">{p.category ?? '—'}</TD>
                    <TD className="text-slate-400">{p.market_region ?? '—'}</TD>
                    <TD>
                      <Badge tone={statusTone(p.lifecycle_status)}>{p.lifecycle_status ?? 'active'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(p.compliance_status)}>{p.compliance_status ?? 'unknown'}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/dashboard/products/${p.id}`}>
                          <Button variant="ghost" size="sm">View</Button>
                        </Link>
                        <Button variant="danger" size="sm" onClick={() => setDeleteTarget(p)}>
                          Delete
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New product"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="create-product-form" disabled={saving}>
              {saving ? 'Creating...' : 'Create product'}
            </Button>
          </>
        }
      >
        <form id="create-product-form" onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Name" required>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
              placeholder="Main control board"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="SKU">
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={inputCls} placeholder="MCB-001" />
            </Field>
            <Field label="Part number">
              <input value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} className={inputCls} placeholder="PN-12345" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} placeholder="PCBA" />
            </Field>
            <Field label="Market region">
              <select value={form.market_region} onChange={(e) => setForm({ ...form, market_region: e.target.value })} className={inputCls}>
                <option value="EU">EU</option>
                <option value="UK">UK</option>
                <option value="US">US</option>
                <option value="CN">CN</option>
                <option value="Global">Global</option>
              </select>
            </Field>
          </div>
          <Field label="Lifecycle status">
            <select value={form.lifecycle_status} onChange={(e) => setForm({ ...form, lifecycle_status: e.target.value })} className={inputCls}>
              <option value="active">Active</option>
              <option value="prototype">Prototype</option>
              <option value="eol">End of life</option>
            </select>
          </Field>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete product"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          Delete <span className="font-medium text-slate-200">{deleteTarget?.name}</span>? This removes its BOMs and
          compliance history. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
        {required && <span className="text-lime-400"> *</span>}
      </span>
      {children}
    </label>
  )
}
