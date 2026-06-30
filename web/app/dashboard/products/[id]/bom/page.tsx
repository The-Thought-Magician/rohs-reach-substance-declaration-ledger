'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface BomVersion {
  id: string
  product_id: string
  revision: string
  is_active?: boolean | null
  notes?: string | null
  created_at?: string
}

interface BomItem {
  id: string
  bom_version_id: string
  component_id: string
  parent_id?: string | null
  reference?: string | null
  quantity?: number | null
  mass_grams?: number | null
  created_at?: string
}

interface Component {
  id: string
  name: string
  manufacturer_part_number?: string | null
  manufacturer?: string | null
  mass_grams?: number | null
}

interface TreeNode extends BomItem {
  children: TreeNode[]
  depth: number
}

const emptyItemForm = {
  component_id: '',
  parent_id: '',
  reference: '',
  quantity: '1',
  mass_grams: '',
}

export default function BomEditorPage() {
  const params = useParams()
  const productId = String(params?.id ?? '')

  const [versions, setVersions] = useState<BomVersion[]>([])
  const [activeVersionId, setActiveVersionId] = useState<string>('')
  const [items, setItems] = useState<BomItem[]>([])
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // version create
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [versionForm, setVersionForm] = useState({ revision: '', notes: '' })
  const [savingVersion, setSavingVersion] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)

  // item add/edit
  const [itemModalOpen, setItemModalOpen] = useState(false)
  const [itemEditing, setItemEditing] = useState<BomItem | null>(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [savingItem, setSavingItem] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)

  // CSV import
  const [importOpen, setImportOpen] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)

  const componentMap = useMemo(() => {
    const m = new Map<string, Component>()
    for (const c of components) m.set(c.id, c)
    return m
  }, [components])

  async function loadVersions() {
    setLoading(true)
    setError(null)
    try {
      const [vers, comps] = await Promise.all([
        api.listBomVersions(productId),
        api.listComponents(),
      ])
      const vlist: BomVersion[] = Array.isArray(vers) ? vers : []
      setVersions(vlist)
      setComponents(Array.isArray(comps) ? comps : [])
      const initial = vlist.find((v) => v.is_active)?.id ?? vlist[0]?.id ?? ''
      setActiveVersionId(initial)
      if (initial) await loadItems(initial)
      else setItems([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load BOM')
    } finally {
      setLoading(false)
    }
  }

  async function loadItems(versionId: string) {
    setItemsLoading(true)
    try {
      const data = await api.listBomItems(versionId)
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load BOM items')
    } finally {
      setItemsLoading(false)
    }
  }

  useEffect(() => {
    if (productId) loadVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  function selectVersion(versionId: string) {
    setActiveVersionId(versionId)
    loadItems(versionId)
  }

  // ---- build tree ----
  const tree = useMemo<TreeNode[]>(() => {
    const byId = new Map<string, TreeNode>()
    for (const it of items) byId.set(it.id, { ...it, children: [], depth: 0 })
    const roots: TreeNode[] = []
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id)!.children.push(node)
      } else {
        roots.push(node)
      }
    }
    const order: TreeNode[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        n.depth = depth
        order.push(n)
        walk(n.children, depth + 1)
      }
    }
    walk(roots, 0)
    return order
  }, [items])

  const totals = useMemo(() => {
    let qty = 0
    let mass = 0
    for (const it of items) {
      qty += Number(it.quantity) || 0
      mass += (Number(it.mass_grams) || 0) * (Number(it.quantity) || 1)
    }
    const distinct = new Set(items.map((i) => i.component_id)).size
    return { qty, mass, distinct }
  }, [items])

  // ---- version actions ----
  async function createVersion(e: React.FormEvent) {
    e.preventDefault()
    setSavingVersion(true)
    setVersionError(null)
    try {
      const v: BomVersion = await api.createBomVersion(productId, {
        revision: versionForm.revision.trim(),
        notes: versionForm.notes.trim() || null,
      })
      setVersionModalOpen(false)
      setVersionForm({ revision: '', notes: '' })
      await loadVersions()
      if (v?.id) selectVersion(v.id)
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : 'Failed to create version')
    } finally {
      setSavingVersion(false)
    }
  }

  async function cloneVersion(versionId: string) {
    if (!confirm('Clone this revision into a new editable version?')) return
    try {
      const v: BomVersion = await api.cloneBomVersion(productId, versionId)
      await loadVersions()
      if (v?.id) selectVersion(v.id)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to clone version')
    }
  }

  // ---- item actions ----
  function openAddItem(parentId?: string) {
    setItemEditing(null)
    setItemForm({ ...emptyItemForm, parent_id: parentId ?? '' })
    setItemError(null)
    setItemModalOpen(true)
  }
  function openEditItem(it: BomItem) {
    setItemEditing(it)
    setItemForm({
      component_id: it.component_id,
      parent_id: it.parent_id ?? '',
      reference: it.reference ?? '',
      quantity: it.quantity != null ? String(it.quantity) : '1',
      mass_grams: it.mass_grams != null ? String(it.mass_grams) : '',
    })
    setItemError(null)
    setItemModalOpen(true)
  }

  function onComponentPick(componentId: string) {
    const comp = componentMap.get(componentId)
    setItemForm((f) => ({
      ...f,
      component_id: componentId,
      mass_grams: f.mass_grams === '' && comp?.mass_grams != null ? String(comp.mass_grams) : f.mass_grams,
    }))
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault()
    if (!activeVersionId) return
    setSavingItem(true)
    setItemError(null)
    try {
      const body: Record<string, unknown> = {
        component_id: itemForm.component_id,
        parent_id: itemForm.parent_id || null,
        reference: itemForm.reference.trim() || null,
        quantity: itemForm.quantity !== '' ? Number(itemForm.quantity) : 1,
      }
      if (itemForm.mass_grams !== '') body.mass_grams = Number(itemForm.mass_grams)
      if (itemEditing) {
        await api.updateBomItem(itemEditing.id, body)
      } else {
        await api.addBomItem(activeVersionId, body)
      }
      setItemModalOpen(false)
      await loadItems(activeVersionId)
    } catch (e) {
      setItemError(e instanceof Error ? e.message : 'Failed to save item')
    } finally {
      setSavingItem(false)
    }
  }

  async function deleteItem(it: BomItem) {
    const hasChildren = items.some((x) => x.parent_id === it.id)
    if (!confirm(hasChildren ? 'Delete this item and re-parent or remove its children?' : 'Delete this BOM item?')) return
    try {
      await api.deleteBomItem(it.id)
      await loadItems(activeVersionId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete item')
    }
  }

  // ---- CSV import ----
  // Expected header columns (case-insensitive): reference, component_id (or mpn/component), quantity, mass_grams, parent_reference
  function parseCsv(text: string): Record<string, string>[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length < 2) return []
    const splitLine = (line: string) =>
      line.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    const headers = splitLine(lines[0]).map((h) => h.toLowerCase())
    return lines.slice(1).map((line) => {
      const cells = splitLine(line)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? ''
      })
      return row
    })
  }

  const parsedRows = useMemo(() => parseCsv(csvText), [csvText])

  function resolveComponentId(row: Record<string, string>): string | null {
    if (row.component_id) return row.component_id
    const key = (row.mpn || row.component || row.name || '').toLowerCase()
    if (!key) return null
    const match = components.find(
      (c) =>
        (c.manufacturer_part_number ?? '').toLowerCase() === key ||
        c.name.toLowerCase() === key,
    )
    return match?.id ?? null
  }

  interface ImportRow {
    component_id: string | null
    reference: string | null
    quantity: number
    mass_grams?: number
    parent_reference?: string
    _matched: boolean
    _raw: Record<string, string>
  }

  const importRows = useMemo<ImportRow[]>(() => {
    return parsedRows.map((row) => {
      const componentId = resolveComponentId(row)
      const out: ImportRow = {
        component_id: componentId,
        reference: row.reference || row.ref || null,
        quantity: row.quantity ? Number(row.quantity) : 1,
        _matched: !!componentId,
        _raw: row,
      }
      if (row.mass_grams) out.mass_grams = Number(row.mass_grams)
      if (row.parent_reference) out.parent_reference = row.parent_reference
      return out
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedRows, components])

  const unmatchedCount = importRows.filter((r) => !r._matched).length

  async function runImport() {
    if (!activeVersionId) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const rows = importRows
        .filter((r) => r._matched)
        .map(({ _matched, _raw, ...rest }) => rest)
      if (rows.length === 0) {
        setImportError('No rows could be matched to a component.')
        setImporting(false)
        return
      }
      const res = await api.importBom(activeVersionId, { rows })
      setImportResult(`Imported ${res?.created ?? rows.length} item(s).`)
      await loadItems(activeVersionId)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const activeVersion = versions.find((v) => v.id === activeVersionId)

  if (loading) return <PageSpinner label="Loading BOM..." />

  if (error && versions.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-red-300">{error}</div>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={loadVersions}>
              Retry
            </Button>
            <Link href={`/dashboard/products/${productId}`}>
              <Button variant="ghost">Back to product</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/dashboard/products" className="hover:text-lime-400">
              Products
            </Link>
            <span>/</span>
            <Link href={`/dashboard/products/${productId}`} className="hover:text-lime-400">
              Product
            </Link>
            <span>/</span>
            <span className="text-slate-400">BOM</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">Bill of Materials</h1>
          <p className="mt-1 text-sm text-slate-500">
            Build the part hierarchy, then import or edit components to drive substance roll-up.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)} disabled={!activeVersionId}>
            Import CSV
          </Button>
          <Button onClick={() => { setVersionForm({ revision: '', notes: '' }); setVersionError(null); setVersionModalOpen(true) }}>
            + New revision
          </Button>
        </div>
      </div>

      {versions.length === 0 ? (
        <EmptyState
          title="No BOM revisions yet"
          description="Create your first revision, then add components to define the bill of materials."
          action={<Button onClick={() => setVersionModalOpen(true)}>+ Create revision</Button>}
        />
      ) : (
        <>
          {/* Version selector */}
          <Card>
            <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => selectVersion(v.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      v.id === activeVersionId
                        ? 'border-lime-500 bg-lime-500/10 text-lime-300'
                        : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    Rev {v.revision}
                    {v.is_active && <span className="ml-1.5 text-xs text-lime-400">●</span>}
                  </button>
                ))}
              </div>
              {activeVersion && (
                <div className="flex items-center gap-3">
                  {activeVersion.is_active && <Badge tone="success">active</Badge>}
                  <Button variant="secondary" size="sm" onClick={() => cloneVersion(activeVersion.id)}>
                    Clone revision
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {activeVersion?.notes && (
            <p className="text-sm text-slate-500">Notes: {activeVersion.notes}</p>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Line items" value={items.length} tone="lime" />
            <Stat label="Distinct parts" value={totals.distinct} />
            <Stat label="Total quantity" value={totals.qty} />
            <Stat label="Assembly mass" value={`${totals.mass.toFixed(1)} g`} />
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                BOM tree — Rev {activeVersion?.revision}
              </h2>
              <Button size="sm" onClick={() => openAddItem()} disabled={!activeVersionId}>
                + Add item
              </Button>
            </CardHeader>
            <CardBody>
              {itemsLoading ? (
                <PageSpinner label="Loading items..." />
              ) : tree.length === 0 ? (
                <EmptyState
                  title="Empty BOM"
                  description="Add a top-level component or import a CSV to populate this revision."
                  action={
                    <div className="flex gap-2">
                      <Button onClick={() => openAddItem()}>+ Add item</Button>
                      <Button variant="secondary" onClick={() => setImportOpen(true)}>
                        Import CSV
                      </Button>
                    </div>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Component</th>
                        <th className="px-3 py-2 font-medium">Ref</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Unit mass</th>
                        <th className="px-3 py-2 text-right font-medium">Ext. mass</th>
                        <th className="px-3 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {tree.map((node) => {
                        const comp = componentMap.get(node.component_id)
                        const qty = Number(node.quantity) || 0
                        const unit = Number(node.mass_grams) || 0
                        return (
                          <tr key={node.id} className="hover:bg-slate-900/40">
                            <td className="px-3 py-2">
                              <div
                                className="flex items-center"
                                style={{ paddingLeft: `${node.depth * 18}px` }}
                              >
                                {node.depth > 0 && (
                                  <span className="mr-2 text-slate-700">└</span>
                                )}
                                <div>
                                  {comp ? (
                                    <Link
                                      href={`/dashboard/components/${comp.id}`}
                                      className="font-medium text-slate-100 hover:text-lime-400"
                                    >
                                      {comp.name}
                                    </Link>
                                  ) : (
                                    <span className="text-slate-400">Unknown component</span>
                                  )}
                                  {comp?.manufacturer_part_number && (
                                    <span className="ml-2 font-mono text-xs text-slate-600">
                                      {comp.manufacturer_part_number}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-400">{node.reference || '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                              {unit ? `${unit.toFixed(2)} g` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {unit ? `${(unit * qty).toFixed(2)} g` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-1.5">
                                <Button size="sm" variant="ghost" onClick={() => openAddItem(node.id)}>
                                  + Sub
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => openEditItem(node)}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => deleteItem(node)}>
                                  Del
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* New version modal */}
      <Modal
        open={versionModalOpen}
        onClose={() => setVersionModalOpen(false)}
        title="New BOM revision"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVersionModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="version-form" disabled={savingVersion || !versionForm.revision.trim()}>
              {savingVersion ? 'Creating...' : 'Create revision'}
            </Button>
          </>
        }
      >
        <form id="version-form" onSubmit={createVersion} className="space-y-4">
          {versionError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {versionError}
            </div>
          )}
          <Field label="Revision" required>
            <input
              value={versionForm.revision}
              onChange={(e) => setVersionForm({ ...versionForm, revision: e.target.value })}
              className={inputCls}
              placeholder="e.g. A, B, 1.2"
              required
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={versionForm.notes}
              onChange={(e) => setVersionForm({ ...versionForm, notes: e.target.value })}
              rows={2}
              className={inputCls}
              placeholder="Change summary"
            />
          </Field>
        </form>
      </Modal>

      {/* Item modal */}
      <Modal
        open={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        title={itemEditing ? 'Edit BOM item' : 'Add BOM item'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setItemModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="item-form" disabled={savingItem || !itemForm.component_id}>
              {savingItem ? 'Saving...' : itemEditing ? 'Save item' : 'Add item'}
            </Button>
          </>
        }
      >
        <form id="item-form" onSubmit={saveItem} className="space-y-4">
          {itemError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {itemError}
            </div>
          )}
          <Field label="Component" required>
            <select
              value={itemForm.component_id}
              onChange={(e) => onComponentPick(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Select a component...</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.manufacturer_part_number ? ` (${c.manufacturer_part_number})` : ''}
                </option>
              ))}
            </select>
            {components.length === 0 && (
              <span className="mt-1 block text-xs text-amber-400">
                No components in catalog.{' '}
                <Link href="/dashboard/components" className="underline">
                  Create one first.
                </Link>
              </span>
            )}
          </Field>
          <Field label="Parent (sub-assembly)">
            <select
              value={itemForm.parent_id}
              onChange={(e) => setItemForm({ ...itemForm, parent_id: e.target.value })}
              className={inputCls}
            >
              <option value="">Top level</option>
              {items
                .filter((it) => it.id !== itemEditing?.id)
                .map((it) => {
                  const comp = componentMap.get(it.component_id)
                  return (
                    <option key={it.id} value={it.id}>
                      {comp?.name ?? 'Item'}
                      {it.reference ? ` — ${it.reference}` : ''}
                    </option>
                  )
                })}
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Reference">
              <input
                value={itemForm.reference}
                onChange={(e) => setItemForm({ ...itemForm, reference: e.target.value })}
                className={inputCls}
                placeholder="R1, U3"
              />
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                step="any"
                min="0"
                value={itemForm.quantity}
                onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Mass (g)">
              <input
                type="number"
                step="any"
                min="0"
                value={itemForm.mass_grams}
                onChange={(e) => setItemForm({ ...itemForm, mass_grams: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
        </form>
      </Modal>

      {/* CSV import modal */}
      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false)
          setImportResult(null)
          setImportError(null)
        }}
        title="Import BOM from CSV"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button
              onClick={runImport}
              disabled={importing || parsedRows.length === 0 || importRows.every((r) => !r._matched)}
            >
              {importing ? 'Importing...' : `Import ${importRows.filter((r) => r._matched).length} row(s)`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-500">
            Header row required. Columns:{' '}
            <code className="text-slate-300">reference, component_id</code> (or{' '}
            <code className="text-slate-300">mpn</code> / <code className="text-slate-300">component</code> name),{' '}
            <code className="text-slate-300">quantity</code>, <code className="text-slate-300">mass_grams</code>,{' '}
            <code className="text-slate-300">parent_reference</code>. Rows are matched to the catalog by id, then by
            MPN/name.
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              CSV content
            </span>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={6}
              className={`${inputCls} font-mono text-xs`}
              placeholder={'reference,mpn,quantity,mass_grams\nR1,RC0402-10K,4,0.002\nU1,STM32F4,1,0.5'}
            />
          </label>

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="info">{parsedRows.length} parsed</Badge>
            <Badge tone="success">{importRows.filter((r) => r._matched).length} matched</Badge>
            {unmatchedCount > 0 && <Badge tone="warning">{unmatchedCount} unmatched</Badge>}
          </div>

          {parsedRows.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Ref</th>
                    <th className="px-3 py-1.5">Component</th>
                    <th className="px-3 py-1.5 text-right">Qty</th>
                    <th className="px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {importRows.map((r, i) => {
                    const comp = r.component_id ? componentMap.get(String(r.component_id)) : undefined
                    return (
                      <tr key={i}>
                        <td className="px-3 py-1.5 text-slate-300">{String(r.reference ?? '—')}</td>
                        <td className="px-3 py-1.5 text-slate-300">
                          {comp?.name ?? (r._raw.mpn || r._raw.component || r._raw.component_id || '—')}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{String(r.quantity)}</td>
                        <td className="px-3 py-1.5">
                          {r._matched ? (
                            <span className="text-lime-400">matched</span>
                          ) : (
                            <span className="text-amber-400">no match</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {importError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {importError}
            </div>
          )}
          {importResult && (
            <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {importResult}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-lime-500 focus:outline-none'

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
        {required && <span className="ml-0.5 text-lime-400">*</span>}
      </span>
      {children}
    </label>
  )
}
