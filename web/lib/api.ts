// API client for RohsReachSubstanceDeclarationLedger.
// Every method is a relative fetch('/api/proxy/<path>') call; the path after
// /api/proxy/ maps 1:1 to the backend's /api/v1/<path>. Same-origin so the Neon
// Auth cookie flows to the proxy route, which injects X-User-Id.

type Json = Record<string, unknown>

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data as T
}

const get = <T = any>(path: string) => req<T>(path)
const post = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = <T = any>(path: string) => req<T>(path, { method: 'DELETE' })

function qs(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  createWorkspace: (body: Json) => post('workspaces', body),
  updateWorkspace: (id: string, body: Json) => put(`workspaces/${id}`, body),
  listMembers: (id: string) => get(`workspaces/${id}/members`),
  addMember: (id: string, body: Json) => post(`workspaces/${id}/members`, body),
  removeMember: (id: string, memberId: string) => del(`workspaces/${id}/members/${memberId}`),

  // Suppliers
  listSuppliers: (workspaceId?: string) => get(`suppliers${qs({ workspace_id: workspaceId })}`),
  getSupplier: (id: string) => get(`suppliers/${id}`),
  getSupplierScorecard: (id: string) => get(`suppliers/${id}/scorecard`),
  createSupplier: (body: Json) => post('suppliers', body),
  updateSupplier: (id: string, body: Json) => put(`suppliers/${id}`, body),
  deleteSupplier: (id: string) => del(`suppliers/${id}`),
  listSupplierContacts: (id: string) => get(`suppliers/${id}/contacts`),
  addSupplierContact: (id: string, body: Json) => post(`suppliers/${id}/contacts`, body),
  deleteSupplierContact: (id: string, contactId: string) => del(`suppliers/${id}/contacts/${contactId}`),

  // Products
  listProducts: (params?: { workspace_id?: string; status?: string }) => get(`products${qs(params)}`),
  getProduct: (id: string) => get(`products/${id}`),
  createProduct: (body: Json) => post('products', body),
  updateProduct: (id: string, body: Json) => put(`products/${id}`, body),
  deleteProduct: (id: string) => del(`products/${id}`),
  getProductRollup: (id: string) => get(`products/${id}/rollup`),

  // BOMs
  listBomVersions: (productId: string) => get(`boms/product/${productId}/versions`),
  createBomVersion: (productId: string, body: Json) => post(`boms/product/${productId}/versions`, body),
  cloneBomVersion: (productId: string, versionId: string) => post(`boms/product/${productId}/clone/${versionId}`),
  listBomItems: (versionId: string) => get(`boms/versions/${versionId}/items`),
  addBomItem: (versionId: string, body: Json) => post(`boms/versions/${versionId}/items`, body),
  updateBomItem: (itemId: string, body: Json) => put(`boms/items/${itemId}`, body),
  deleteBomItem: (itemId: string) => del(`boms/items/${itemId}`),
  importBom: (versionId: string, body: Json) => post(`boms/versions/${versionId}/import`, body),

  // Components
  listComponents: (params?: { workspace_id?: string; substance_cas?: string; supplier_id?: string }) =>
    get(`components${qs(params)}`),
  getComponent: (id: string) => get(`components/${id}`),
  createComponent: (body: Json) => post('components', body),
  updateComponent: (id: string, body: Json) => put(`components/${id}`, body),
  deleteComponent: (id: string) => del(`components/${id}`),

  // Materials
  listMaterials: (componentId: string) => get(`materials/component/${componentId}`),
  addMaterial: (componentId: string, body: Json) => post(`materials/component/${componentId}`, body),
  updateMaterial: (id: string, body: Json) => put(`materials/${id}`, body),
  deleteMaterial: (id: string) => del(`materials/${id}`),
  listMaterialSubstances: (id: string) => get(`materials/${id}/substances`),
  addMaterialSubstance: (id: string, body: Json) => post(`materials/${id}/substances`, body),
  deleteMaterialSubstance: (substanceId: string) => del(`materials/substances/${substanceId}`),

  // Restricted substances
  listRestrictedSubstances: () => get('restricted-substances'),
  getRestrictedSubstance: (id: string) => get(`restricted-substances/${id}`),
  createRestrictedSubstance: (body: Json) => post('restricted-substances', body),
  updateRestrictedSubstance: (id: string, body: Json) => put(`restricted-substances/${id}`, body),
  deleteRestrictedSubstance: (id: string) => del(`restricted-substances/${id}`),

  // SVHC
  listSvhcVersions: () => get('svhc/versions'),
  createSvhcVersion: (body: Json) => post('svhc/versions', body),
  listSvhcSubstances: (versionId?: string) => get(`svhc/substances${qs({ version_id: versionId })}`),
  createSvhcSubstance: (body: Json) => post('svhc/substances', body),
  deleteSvhcSubstance: (id: string) => del(`svhc/substances/${id}`),
  svhcDiff: (from: string, to: string) => get(`svhc/diff${qs({ from, to })}`),
  svhcWatch: (workspaceId?: string) => get(`svhc/watch${qs({ workspace_id: workspaceId })}`),

  // Exemptions
  listExemptions: () => get('exemptions'),
  listExpiringExemptions: (days?: number) => get(`exemptions/expiring${qs({ days })}`),
  createExemption: (body: Json) => post('exemptions', body),
  updateExemption: (id: string, body: Json) => put(`exemptions/${id}`, body),
  deleteExemption: (id: string) => del(`exemptions/${id}`),
  listAppliedExemptions: (workspaceId?: string) => get(`exemptions/applied${qs({ workspace_id: workspaceId })}`),
  applyExemption: (body: Json) => post('exemptions/applied', body),
  removeAppliedExemption: (id: string) => del(`exemptions/applied/${id}`),

  // Declarations
  listDeclarations: (params?: { workspace_id?: string; component_id?: string; supplier_id?: string; status?: string }) =>
    get(`declarations${qs(params)}`),
  getDeclaration: (id: string) => get(`declarations/${id}`),
  createDeclaration: (body: Json) => post('declarations', body),
  updateDeclaration: (id: string, body: Json) => put(`declarations/${id}`, body),
  deleteDeclaration: (id: string) => del(`declarations/${id}`),
  addDeclarationSubstance: (id: string, body: Json) => post(`declarations/${id}/substances`, body),
  deleteDeclarationSubstance: (substanceId: string) => del(`declarations/substances/${substanceId}`),
  listStaleDeclarations: (days?: number, workspaceId?: string) =>
    get(`declarations/stale${qs({ days, workspace_id: workspaceId })}`),

  // Declaration requests
  listDeclarationRequests: (params?: { workspace_id?: string; status?: string; supplier_id?: string }) =>
    get(`declaration-requests${qs(params)}`),
  getRequestLedger: (workspaceId?: string) => get(`declaration-requests/ledger${qs({ workspace_id: workspaceId })}`),
  createDeclarationRequest: (body: Json) => post('declaration-requests', body),
  bulkCreateRequests: (body: Json) => post('declaration-requests/bulk', body),
  updateDeclarationRequest: (id: string, body: Json) => put(`declaration-requests/${id}`, body),
  remindRequest: (id: string) => post(`declaration-requests/${id}/remind`),
  deleteDeclarationRequest: (id: string) => del(`declaration-requests/${id}`),

  // Compliance
  getCompliance: (productId: string) => get(`compliance/product/${productId}`),
  computeCompliance: (productId: string) => post(`compliance/product/${productId}/compute`),
  recomputeAll: (body: Json) => post('compliance/recompute-all', body),
  listComplianceResults: (workspaceId?: string) => get(`compliance/results${qs({ workspace_id: workspaceId })}`),

  // SCIP
  getScipProduct: (productId: string) => get(`scip/product/${productId}`),
  getScipSummary: (workspaceId?: string) => get(`scip${qs({ workspace_id: workspaceId })}`),

  // Packs
  getPack: (productId: string) => get(`packs/product/${productId}`),
  exportPack: (productId: string) => post(`packs/product/${productId}/export`),

  // Notifications
  listNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => post(`notifications/${id}/read`),
  markAllNotificationsRead: () => post('notifications/read-all'),
  deleteNotification: (id: string) => del(`notifications/${id}`),

  // Tasks
  listTasks: (params?: { workspace_id?: string; status?: string; product_id?: string }) => get(`tasks${qs(params)}`),
  getTask: (id: string) => get(`tasks/${id}`),
  createTask: (body: Json) => post('tasks', body),
  updateTask: (id: string, body: Json) => put(`tasks/${id}`, body),
  deleteTask: (id: string) => del(`tasks/${id}`),

  // Audit
  listAudit: (params?: { workspace_id?: string; entity_type?: string; entity_id?: string; limit?: number }) =>
    get(`audit${qs(params)}`),
  getProductAudit: (productId: string) => get(`audit/product/${productId}`),

  // Search
  search: (q: string, workspaceId?: string) => get(`search${qs({ q, workspace_id: workspaceId })}`),
  substanceLookup: (cas: string, workspaceId?: string) => get(`search/substance${qs({ cas, workspace_id: workspaceId })}`),

  // Dashboard
  getOverview: (workspaceId?: string) => get(`dashboard/overview${qs({ workspace_id: workspaceId })}`),

  // Reports
  listReports: (workspaceId?: string) => get(`reports${qs({ workspace_id: workspaceId })}`),
  getReport: (id: string) => get(`reports/${id}`),
  generateReport: (body: Json) => post('reports/generate', body),
  deleteReport: (id: string) => del(`reports/${id}`),

  // Seed
  seedSampleData: () => post('seed'),
  getSeedStatus: (workspaceId?: string) => get(`seed/status${qs({ workspace_id: workspaceId })}`),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => post('billing/checkout'),
  openPortal: () => post('billing/portal'),
}

// Almost every workspace-scoped endpoint requires a ?workspace_id= query param,
// but most pages have no way to obtain one on their own. Resolve (and cache for
// the session) the user's first workspace so every page can pass it along.
let cachedWorkspaceId: string | null | undefined
export async function getActiveWorkspaceId(): Promise<string | null> {
  if (cachedWorkspaceId !== undefined) return cachedWorkspaceId
  let resolved: string | null = null
  try {
    const list = await api.listWorkspaces()
    resolved = Array.isArray(list) && list.length > 0 ? list[0].id : null
  } catch {
    resolved = null
  }
  cachedWorkspaceId = resolved
  return resolved
}

export default api
