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
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Component {
  id: string
  name: string
  manufacturer_part_number?: string | null
  description?: string | null
  manufacturer?: string | null
  mass_grams?: number | null
  supplier_id?: string | null
}

interface Material {
  id: string
  component_id: string
  name: string
  mass_grams?: number | null
  is_homogeneous?: boolean | null
  created_at?: string
}

interface MaterialSubstance {
  id: string
  material_id: string
  substance_name: string
  cas_number?: string | null
  concentration_ppm?: number | null
}

// 0.1% by weight = 1000 ppm: the common RoHS / REACH article reporting threshold.
const REPORTING_PPM = 1000

export default function ComponentDetailPage() {
  const params = useParams()
  const id = String(params?.id ?? '')

  const [component, setComponent] = useState<Component | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [substances, setSubstances] = useState<Record<string, MaterialSubstance[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // component edit
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', manufacturer: '', manufacturer_part_number: '', mass_grams: '', description: '' })
  const [savingComp, setSavingComp] = useState(false)

  // material create/edit
  const [matModalOpen, setMatModalOpen] = useState(false)
  const [matEditing, setMatEditing] = useState<Material | null>(null)
  const [matForm, setMatForm] = useState({ name: '', mass_grams: '', is_homogeneous: true })
  const [savingMat, setSavingMat] = useState(false)
  const [matError, setMatError] = useState<string | null>(null)

  // substance add
  const [subModalMaterial, setSubModalMaterial] = useState<Material | null>(null)
  const [subForm, setSubForm] = useState({ substance_name: '', cas_number: '', concentration_ppm: '' })
  const [savingSub, setSavingSub] = useState(false)
  const [subError, setSubError] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const detail = await api.getComponent(id)
      const comp: Component = detail?.component ?? detail
      setComponent(comp)
      const mats: Material[] = await api.listMaterials(id)
      const matList = Array.isArray(mats) ? mats : []
      setMaterials(matList)
      const subEntries = await Promise.all(
        matList.map(async (m) => {
          const s = await api.listMaterialSubstances(m.id)
          return [m.id, Array.isArray(s) ? s : []] as const
        }),
      )
      setSubstances(Object.fromEntries(subEntries))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load component')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function refreshSubstances(materialId: string) {
    const s = await api.listMaterialSubstances(materialId)
    setSubstances((prev) => ({ ...prev, [materialId]: Array.isArray(s) ? s : [] }))
  }

  // ---- component edit ----
  function openEdit() {
    if (!component) return
    setEditForm({
      name: component.name ?? '',
      manufacturer: component.manufacturer ?? '',
      manufacturer_part_number: component.manufacturer_part_number ?? '',
      mass_grams: component.mass_grams != null ? String(component.mass_grams) : '',
      description: component.description ?? '',
    })
    setEditOpen(true)
  }

  async function saveComponent(e: React.FormEvent) {
    e.preventDefault()
    setSavingComp(true)
    try {
      const body: Record<string, unknown> = {
        name: editForm.name.trim(),
        manufacturer: editForm.manufacturer.trim() || null,
        manufacturer_part_number: editForm.manufacturer_part_number.trim() || null,
        description: editForm.description.trim() || null,
      }
      if (editForm.mass_grams !== '') body.mass_grams = Number(editForm.mass_grams)
      await api.updateComponent(id, body)
      setEditOpen(false)
      await loadAll()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update component')
    } finally {
      setSavingComp(false)
    }
  }

  // ---- material create/edit ----
  function openCreateMaterial() {
    setMatEditing(null)
    setMatForm({ name: '', mass_grams: '', is_homogeneous: true })
    setMatError(null)
    setMatModalOpen(true)
  }
  function openEditMaterial(m: Material) {
    setMatEditing(m)
    setMatForm({
      name: m.name ?? '',
      mass_grams: m.mass_grams != null ? String(m.mass_grams) : '',
      is_homogeneous: m.is_homogeneous ?? true,
    })
    setMatError(null)
    setMatModalOpen(true)
  }

  async function saveMaterial(e: React.FormEvent) {
    e.preventDefault()
    setSavingMat(true)
    setMatError(null)
    try {
      const body: Record<string, unknown> = {
        name: matForm.name.trim(),
        is_homogeneous: matForm.is_homogeneous,
      }
      if (matForm.mass_grams !== '') body.mass_grams = Number(matForm.mass_grams)
      if (matEditing) {
        await api.updateMaterial(matEditing.id, body)
      } else {
        await api.addMaterial(id, body)
      }
      setMatModalOpen(false)
      await loadAll()
    } catch (e) {
      setMatError(e instanceof Error ? e.message : 'Failed to save material')
    } finally {
      setSavingMat(false)
    }
  }

  async function deleteMaterial(m: Material) {
    if (!confirm(`Delete material "${m.name}" and its substances?`)) return
    try {
      await api.deleteMaterial(m.id)
      setMaterials((prev) => prev.filter((x) => x.id !== m.id))
      setSubstances((prev) => {
        const next = { ...prev }
        delete next[m.id]
        return next
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete material')
    }
  }

  // ---- substance add/remove ----
  function openAddSubstance(m: Material) {
    setSubModalMaterial(m)
    setSubForm({ substance_name: '', cas_number: '', concentration_ppm: '' })
    setSubError(null)
  }

  async function saveSubstance(e: React.FormEvent) {
    e.preventDefault()
    if (!subModalMaterial) return
    setSavingSub(true)
    setSubError(null)
    try {
      const body: Record<string, unknown> = {
        substance_name: subForm.substance_name.trim(),
        cas_number: subForm.cas_number.trim() || null,
      }
      if (subForm.concentration_ppm !== '') body.concentration_ppm = Number(subForm.concentration_ppm)
      await api.addMaterialSubstance(subModalMaterial.id, body)
      await refreshSubstances(subModalMaterial.id)
      setSubModalMaterial(null)
    } catch (e) {
      setSubError(e instanceof Error ? e.message : 'Failed to add substance')
    } finally {
      setSavingSub(false)
    }
  }

  async function deleteSubstance(materialId: string, s: MaterialSubstance) {
    if (!confirm(`Remove ${s.substance_name} from this material?`)) return
    try {
      await api.deleteMaterialSubstance(s.id)
      setSubstances((prev) => ({
        ...prev,
        [materialId]: (prev[materialId] ?? []).filter((x) => x.id !== s.id),
      }))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove substance')
    }
  }

  const allSubstances = useMemo(() => Object.values(substances).flat(), [substances])
  const flaggedCount = useMemo(
    () => allSubstances.filter((s) => (Number(s.concentration_ppm) || 0) >= REPORTING_PPM).length,
    [allSubstances],
  )
  const homogeneousCount = useMemo(
    () => materials.filter((m) => m.is_homogeneous).length,
    [materials],
  )
  const declaredMass = useMemo(
    () => materials.reduce((acc, m) => acc + (Number(m.mass_grams) || 0), 0),
    [materials],
  )

  if (loading) return <PageSpinner label="Loading component..." />

  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-red-300">{error}</div>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={loadAll}>
              Retry
            </Button>
            <Link href="/dashboard/components">
              <Button variant="ghost">Back to catalog</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    )
  }

  if (!component) {
    return <EmptyState title="Component not found" action={<Link href="/dashboard/components"><Button variant="secondary">Back to catalog</Button></Link>} />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/dashboard/components" className="hover:text-yellow-400">
              Components
            </Link>
            <span>/</span>
            <span className="text-slate-400">{component.name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-100">{component.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            {component.manufacturer_part_number && (
              <span className="font-mono text-xs">MPN {component.manufacturer_part_number}</span>
            )}
            {component.manufacturer && <span>{component.manufacturer}</span>}
            {flaggedCount > 0 && <Badge tone="danger">{flaggedCount} over 0.1%</Badge>}
          </div>
          {component.description && <p className="mt-2 max-w-2xl text-sm text-slate-400">{component.description}</p>}
        </div>
        <Button variant="secondary" onClick={openEdit}>
          Edit component
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Materials" value={materials.length} tone="lime" />
        <Stat label="Homogeneous" value={homogeneousCount} />
        <Stat label="Substances" value={allSubstances.length} />
        <Stat
          label="Over 0.1% (1000 ppm)"
          value={flaggedCount}
          tone={flaggedCount > 0 ? 'danger' : 'success'}
        />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Material breakdown</h2>
            <p className="text-xs text-slate-500">
              Declared mass {declaredMass.toFixed(2)} g
              {component.mass_grams != null && ` of ${Number(component.mass_grams).toFixed(2)} g component mass`}
            </p>
          </div>
          <Button size="sm" onClick={openCreateMaterial}>
            + Material
          </Button>
        </CardHeader>
        <CardBody>
          {materials.length === 0 ? (
            <EmptyState
              title="No materials declared"
              description="Break this component into homogeneous materials, then record each substance and its concentration."
              action={<Button onClick={openCreateMaterial}>+ Add first material</Button>}
            />
          ) : (
            <div className="space-y-5">
              {materials.map((m) => {
                const subs = substances[m.id] ?? []
                const matFlagged = subs.filter((s) => (Number(s.concentration_ppm) || 0) >= REPORTING_PPM)
                const maxPpm = subs.reduce((mx, s) => Math.max(mx, Number(s.concentration_ppm) || 0), 0)
                return (
                  <div key={m.id} className="rounded-xl border border-slate-800 bg-slate-950/40">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-100">{m.name}</span>
                        {m.is_homogeneous ? (
                          <Badge tone="lime">homogeneous</Badge>
                        ) : (
                          <Badge tone="neutral">assembly</Badge>
                        )}
                        {m.mass_grams != null && (
                          <span className="text-xs text-slate-500">{Number(m.mass_grams).toFixed(2)} g</span>
                        )}
                        {matFlagged.length > 0 && (
                          <Badge tone="danger">{matFlagged.length} flagged</Badge>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => openAddSubstance(m)}>
                          + Substance
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openEditMaterial(m)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => deleteMaterial(m)}>
                          Delete
                        </Button>
                      </div>
                    </div>

                    {subs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-600">
                        No substances recorded for this material yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs uppercase tracking-wide text-slate-600">
                            <tr>
                              <th className="px-4 py-2 font-medium">Substance</th>
                              <th className="px-4 py-2 font-medium">CAS #</th>
                              <th className="px-4 py-2 font-medium">Concentration</th>
                              <th className="px-4 py-2 font-medium">Share of material</th>
                              <th className="px-4 py-2 text-right font-medium">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-900">
                            {subs.map((s) => {
                              const ppm = Number(s.concentration_ppm) || 0
                              const over = ppm >= REPORTING_PPM
                              const pct = Math.min(100, (ppm / 10000) * 100) // 1% = full bar reference
                              return (
                                <tr key={s.id}>
                                  <td className="px-4 py-2 text-slate-200">{s.substance_name}</td>
                                  <td className="px-4 py-2 font-mono text-xs text-slate-400">
                                    {s.cas_number || '—'}
                                  </td>
                                  <td className="px-4 py-2 tabular-nums">
                                    <span className={over ? 'font-semibold text-red-300' : 'text-slate-300'}>
                                      {ppm.toLocaleString()} ppm
                                    </span>
                                    <span className="ml-1 text-xs text-slate-600">
                                      ({(ppm / 10000).toFixed(3)}%)
                                    </span>
                                    {over && (
                                      <Badge tone="danger" className="ml-2">
                                        ≥0.1%
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-800">
                                      <div
                                        className={`h-full ${over ? 'bg-red-500' : 'bg-yellow-500'}`}
                                        style={{ width: `${Math.max(2, pct)}%` }}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => deleteSubstance(m.id, s)}
                                    >
                                      Remove
                                    </Button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        {maxPpm > 0 && (
                          <div className="px-4 py-2 text-xs text-slate-600">
                            Peak concentration {maxPpm.toLocaleString()} ppm
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Edit component modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit component"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="comp-edit-form" disabled={savingComp || !editForm.name.trim()}>
              {savingComp ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <form id="comp-edit-form" onSubmit={saveComponent} className="space-y-4">
          <Field label="Name" required>
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Manufacturer part number">
              <input value={editForm.manufacturer_part_number} onChange={(e) => setEditForm({ ...editForm, manufacturer_part_number: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Manufacturer">
              <input value={editForm.manufacturer} onChange={(e) => setEditForm({ ...editForm, manufacturer: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Mass (grams)">
            <input type="number" step="any" min="0" value={editForm.mass_grams} onChange={(e) => setEditForm({ ...editForm, mass_grams: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Description">
            <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} className={inputCls} />
          </Field>
        </form>
      </Modal>

      {/* Material modal */}
      <Modal
        open={matModalOpen}
        onClose={() => setMatModalOpen(false)}
        title={matEditing ? 'Edit material' : 'New material'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMatModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="mat-form" disabled={savingMat || !matForm.name.trim()}>
              {savingMat ? 'Saving...' : matEditing ? 'Save material' : 'Add material'}
            </Button>
          </>
        }
      >
        <form id="mat-form" onSubmit={saveMaterial} className="space-y-4">
          {matError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {matError}
            </div>
          )}
          <Field label="Material name" required>
            <input value={matForm.name} onChange={(e) => setMatForm({ ...matForm, name: e.target.value })} className={inputCls} placeholder="e.g. FR4 substrate, tin-plated copper" required />
          </Field>
          <Field label="Mass (grams)">
            <input type="number" step="any" min="0" value={matForm.mass_grams} onChange={(e) => setMatForm({ ...matForm, mass_grams: e.target.value })} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={matForm.is_homogeneous}
              onChange={(e) => setMatForm({ ...matForm, is_homogeneous: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-yellow-500 focus:ring-yellow-500"
            />
            Homogeneous material (RoHS thresholds apply at this level)
          </label>
        </form>
      </Modal>

      {/* Substance modal */}
      <Modal
        open={!!subModalMaterial}
        onClose={() => setSubModalMaterial(null)}
        title={subModalMaterial ? `Add substance to ${subModalMaterial.name}` : 'Add substance'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSubModalMaterial(null)}>
              Cancel
            </Button>
            <Button type="submit" form="sub-form" disabled={savingSub || !subForm.substance_name.trim()}>
              {savingSub ? 'Adding...' : 'Add substance'}
            </Button>
          </>
        }
      >
        <form id="sub-form" onSubmit={saveSubstance} className="space-y-4">
          {subError && (
            <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {subError}
            </div>
          )}
          <Field label="Substance name" required>
            <input value={subForm.substance_name} onChange={(e) => setSubForm({ ...subForm, substance_name: e.target.value })} className={inputCls} placeholder="e.g. Lead" required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="CAS number">
              <input value={subForm.cas_number} onChange={(e) => setSubForm({ ...subForm, cas_number: e.target.value })} className={inputCls} placeholder="7439-92-1" />
            </Field>
            <Field label="Concentration (ppm)">
              <input type="number" step="any" min="0" value={subForm.concentration_ppm} onChange={(e) => setSubForm({ ...subForm, concentration_ppm: e.target.value })} className={inputCls} placeholder="1000" />
            </Field>
          </div>
          <p className="text-xs text-slate-600">
            1000 ppm = 0.1% by weight, the RoHS homogeneous-material and REACH article reporting threshold.
          </p>
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
