import { createMiddleware } from 'hono/factory'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspace_members, workspaces } from '../db/schema.js'

export type Env = { Variables: { userId: string } }
export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  c.set('userId', userId)
  await next()
})
export function getUserId(c: any): string {
  return c.get('userId') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
}

export async function userCanAccessWorkspace(userId: string, workspaceId: string | null | undefined): Promise<boolean> {
  if (!userId || !workspaceId) return false
  const [owned] = await db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), eq(workspaces.owner_id, userId)))
  if (owned) return true
  const [member] = await db.select().from(workspace_members).where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

// Canonical set of declaration-request statuses that count as "returned/received".
// Shared across declaration-requests.ts, suppliers.ts, and reports.ts so the
// "who has and hasn't returned" logic agrees everywhere it is computed.
export const RECEIVED_REQUEST_STATUSES = new Set(['received', 'completed', 'fulfilled', 'closed'])
