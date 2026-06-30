// ---------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic scheduling primitives used by routes. No external
// services, no I/O. Every function is total and side-effect free so it can be
// unit-tested in isolation and called inline from request handlers.
//
// Three "kinds" of schedule are supported uniformly:
//   - 'cron'   : a standard 5/6-field cron expression, parsed via cron-parser.
//   - 'rate'   : a natural-language rate "every N minutes|hours|days".
//   - 'oneoff' : a single ISO-8601 instant, fired exactly once.
//
// All instants returned are ISO-8601 UTC strings (…Z).
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CronJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  start: string // ISO instant
  end: string // ISO instant
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Rate-expression parsing: "every N minutes|hours|days"
// ---------------------------------------------------------------------------

interface ParsedRate {
  amount: number
  unitMs: number
}

function parseRate(expr: string): ParsedRate | null {
  const m = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/i.exec(expr.trim())
  if (!m) return null
  const amount = parseInt(m[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = m[2].toLowerCase()
  const unitMs = unit.startsWith('minute') ? MINUTE_MS : unit.startsWith('hour') ? HOUR_MS : DAY_MS
  return { amount, unitMs }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  const trimmed = (expr ?? '').trim()
  if (!trimmed) return { valid: false, error: 'Expression is empty' }

  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(trimmed)
      return { valid: true }
    } catch (e: unknown) {
      return { valid: false, error: e instanceof Error ? e.message : 'Invalid cron expression' }
    }
  }

  if (kind === 'rate') {
    const parsed = parseRate(trimmed)
    if (!parsed) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
    return { valid: true }
  }

  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off must be a valid ISO-8601 instant' }
    return { valid: true }
  }

  return { valid: false, error: `Unknown schedule kind: ${String(kind)}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  // Support 5-field (m h dom mon dow) and 6-field (s m h dom mon dow).
  let min: string, hr: string, dom: string, mon: string, dow: string
  if (parts.length === 6) {
    ;[, min, hr, dom, mon, dow] = parts
  } else if (parts.length === 5) {
    ;[min, hr, dom, mon, dow] = parts
  } else {
    return `Runs on cron schedule "${expr}"`
  }

  const segments: string[] = []
  if (min === '*' && hr === '*') {
    segments.push('every minute')
  } else if (min.startsWith('*/')) {
    segments.push(`every ${min.slice(2)} minutes`)
  } else if (hr === '*') {
    segments.push(`at minute ${min} of every hour`)
  } else if (/^\d+$/.test(min) && /^\d+$/.test(hr)) {
    segments.push(`at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`)
  } else {
    segments.push(`at minute ${min}, hour ${hr}`)
  }

  if (dow !== '*') {
    const days = dow
      .split(',')
      .map((d) => {
        const n = parseInt(d, 10)
        return Number.isFinite(n) && n >= 0 && n <= 7 ? DOW[n % 7] : d
      })
      .join(', ')
    segments.push(`on ${days}`)
  }
  if (dom !== '*') segments.push(`on day-of-month ${dom}`)
  if (mon !== '*') segments.push(`in month ${mon}`)

  return `Runs ${segments.join(' ')}`
}

export function describeExpression(kind: ScheduleKind, expr: string, timezone?: string): string {
  const tzSuffix = timezone ? ` (${timezone})` : ''
  const trimmed = (expr ?? '').trim()

  if (kind === 'cron') return describeCron(trimmed) + tzSuffix

  if (kind === 'rate') {
    const parsed = parseRate(trimmed)
    if (!parsed) return `Invalid rate expression "${trimmed}"`
    const unit = parsed.unitMs === MINUTE_MS ? 'minute' : parsed.unitMs === HOUR_MS ? 'hour' : 'day'
    const plural = parsed.amount === 1 ? unit : `${unit}s`
    return `Runs every ${parsed.amount} ${plural}${tzSuffix}`
  }

  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return `Invalid one-off instant "${trimmed}"`
    return `Runs once at ${new Date(t).toISOString()}`
  }

  return `Unknown schedule kind "${String(kind)}"`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string,
  fromISO: string,
  count: number,
): string[] {
  const trimmed = (expr ?? '').trim()
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []

  const fromMs = Date.parse(fromISO)
  const from = Number.isNaN(fromMs) ? new Date() : new Date(fromMs)

  if (kind === 'cron') {
    try {
      const interval = CronExpressionParser.parse(trimmed, {
        tz: timezone || 'UTC',
        currentDate: from,
      })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        out.push(interval.next().toDate().toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const parsed = parseRate(trimmed)
    if (!parsed) return []
    const out: string[] = []
    let t = from.getTime()
    const step = parsed.amount * parsed.unitMs
    for (let i = 0; i < n; i++) {
      t += step
      out.push(new Date(t).toISOString())
    }
    return out
  }

  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  return []
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

function minuteBucket(iso: string): string {
  // Truncate an ISO instant to the minute (drop seconds/millis).
  return new Date(Math.floor(Date.parse(iso) / MINUTE_MS) * MINUTE_MS).toISOString()
}

function severityFor(concurrency: number, threshold: number): 'low' | 'medium' | 'high' {
  if (concurrency >= threshold * 2) return 'high'
  if (concurrency >= threshold) return 'medium'
  return 'low'
}

export function computeCollisions(
  jobs: CronJob[],
  opts: { horizonDays: number; threshold: number },
): CollisionWindow[] {
  const horizonDays = Math.max(1, opts.horizonDays)
  const threshold = Math.max(1, opts.threshold)
  const fromISO = new Date().toISOString()
  const horizonEnd = Date.now() + horizonDays * DAY_MS

  // Generate firings per job up to the horizon, bucketed to the minute.
  type Firing = { jobId: string; resourceId?: string; bucket: string }
  const firings: Firing[] = []

  for (const job of jobs) {
    // Pull a generous number of firings, then clip to horizon.
    const candidates = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of candidates) {
      if (Date.parse(f) > horizonEnd) break
      firings.push({ jobId: job.id, resourceId: job.resourceId, bucket: minuteBucket(f) })
    }
  }

  // Group by minute bucket.
  const byBucket = new Map<string, Firing[]>()
  for (const f of firings) {
    const arr = byBucket.get(f.bucket)
    if (arr) arr.push(f)
    else byBucket.set(f.bucket, [f])
  }

  const windows: CollisionWindow[] = []
  for (const [bucket, group] of byBucket) {
    const jobIds = Array.from(new Set(group.map((g) => g.jobId)))
    const concurrency = jobIds.length

    // Detect a shared resource within this minute.
    const byResource = new Map<string, Set<string>>()
    for (const g of group) {
      if (!g.resourceId) continue
      const set = byResource.get(g.resourceId) ?? new Set<string>()
      set.add(g.jobId)
      byResource.set(g.resourceId, set)
    }
    let sharedResource: string | undefined
    for (const [resId, set] of byResource) {
      if (set.size >= 2) {
        sharedResource = resId
        break
      }
    }

    const flagged = concurrency >= threshold || sharedResource !== undefined
    if (!flagged) continue

    const start = Date.parse(bucket)
    windows.push({
      windowStart: bucket,
      windowEnd: new Date(start + MINUTE_MS).toISOString(),
      jobIds,
      severity: severityFor(concurrency, threshold),
      resourceId: sharedResource,
    })
  }

  windows.sort((a, b) => Date.parse(a.windowStart) - Date.parse(b.windowStart))
  return windows
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(jobs: CronJob[], opts: { horizonDays: number }): HeatmapBucket[] {
  const horizonDays = Math.max(1, opts.horizonDays)
  const fromISO = new Date().toISOString()
  const horizonEnd = Date.now() + horizonDays * DAY_MS

  // Bucket by hour for a readable heatmap.
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const candidates = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of candidates) {
      const t = Date.parse(f)
      if (t > horizonEnd) break
      const hourBucket = new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString()
      counts.set(hourBucket, (counts.get(hourBucket) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => Date.parse(a.bucket) - Date.parse(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps — detect DST anomalies via timezone offset changes
// ---------------------------------------------------------------------------

function offsetMinutes(date: Date, timezone: string): number {
  // Compute the UTC offset (minutes) of `date` in `timezone` using Intl.
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    const asUTC = Date.UTC(
      parseInt(get('year'), 10),
      parseInt(get('month'), 10) - 1,
      parseInt(get('day'), 10),
      parseInt(get('hour'), 10),
      parseInt(get('minute'), 10),
      parseInt(get('second'), 10),
    )
    return Math.round((asUTC - date.getTime()) / MINUTE_MS)
  } catch {
    return 0
  }
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string,
  fromISO: string,
  days: number,
): DstTrap[] {
  const tz = timezone || 'UTC'
  const traps: DstTrap[] = []
  const startMs = Date.parse(fromISO)
  if (Number.isNaN(startMs) || tz === 'UTC') return traps

  const horizon = Math.max(1, days)
  const endMs = startMs + horizon * DAY_MS

  // Walk hour-by-hour and detect offset transitions.
  let prevOffset = offsetMinutes(new Date(startMs), tz)
  for (let t = startMs + HOUR_MS; t <= endMs; t += HOUR_MS) {
    const cur = offsetMinutes(new Date(t), tz)
    if (cur === prevOffset) continue

    const delta = cur - prevOffset
    const atUtc = new Date(t).toISOString()
    // Local wall-clock representation at the transition instant.
    const atLocal = new Date(t + cur * MINUTE_MS).toISOString().replace('Z', '')

    if (delta > 0) {
      // Spring forward: a local-time window is skipped.
      traps.push({ type: 'skip', atLocal, atUtc })
    } else {
      // Fall back: a local-time window repeats (ambiguous / potential double fire).
      traps.push({ type: 'ambiguous', atLocal, atUtc })
      // For schedules that fire within the repeated window, this manifests as a double fire.
      const fireInWindow =
        kind === 'cron'
          ? nextFirings(kind, expr, tz, new Date(t - HOUR_MS).toISOString(), 3).some((f) => {
              const ft = Date.parse(f)
              return ft >= t - HOUR_MS && ft <= t + HOUR_MS
            })
          : kind === 'rate'
      if (fireInWindow) {
        traps.push({ type: 'double_fire', atLocal, atUtc })
      }
    }
    prevOffset = cur
  }

  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps — find windows of expected coverage with no scheduled firing
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: CronJob[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const horizonDays = Math.max(1, opts.horizonDays)
  const fromISO = new Date().toISOString()
  const horizonEnd = Date.now() + horizonDays * DAY_MS

  // Collect all firing instants within the horizon, sorted.
  const fireTimes: number[] = []
  for (const job of jobs) {
    const candidates = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of candidates) {
      const t = Date.parse(f)
      if (t > horizonEnd) break
      fireTimes.push(t)
    }
  }
  fireTimes.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const wStart = Date.parse(w.start)
    const wEnd = Date.parse(w.end)
    if (Number.isNaN(wStart) || Number.isNaN(wEnd) || wEnd <= wStart) continue

    // Firings inside this coverage window.
    const inside = fireTimes.filter((t) => t >= wStart && t <= wEnd)
    if (inside.length === 0) {
      gaps.push({
        gapStart: w.start,
        gapEnd: w.end,
        durationMinutes: Math.round((wEnd - wStart) / MINUTE_MS),
      })
      continue
    }

    // Check leading gap (window start → first firing).
    let cursor = wStart
    for (const t of inside) {
      if (t - cursor > MINUTE_MS) {
        gaps.push({
          gapStart: new Date(cursor).toISOString(),
          gapEnd: new Date(t).toISOString(),
          durationMinutes: Math.round((t - cursor) / MINUTE_MS),
        })
      }
      cursor = t
    }
    // Trailing gap (last firing → window end).
    if (wEnd - cursor > MINUTE_MS) {
      gaps.push({
        gapStart: new Date(cursor).toISOString(),
        gapEnd: w.end,
        durationMinutes: Math.round((wEnd - cursor) / MINUTE_MS),
      })
    }
  }

  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread — propose de-conflicted schedules for colliding jobs
// ---------------------------------------------------------------------------

export function autoSpread(jobs: CronJob[], opts: { threshold: number }): SpreadSuggestion[] {
  const threshold = Math.max(1, opts.threshold)
  const collisions = computeCollisions(jobs, { horizonDays: 7, threshold })
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  // Track how many jobs we have already shifted per colliding bucket so each
  // gets a distinct offset minute.
  const suggestions: SpreadSuggestion[] = []
  const handled = new Set<string>()

  for (const col of collisions) {
    // Keep the first job in place; shift the rest by an increasing offset.
    col.jobIds.forEach((jobId, idx) => {
      if (idx === 0 || handled.has(jobId)) return
      const job = jobById.get(jobId)
      if (!job) return

      const offset = idx % 60
      let suggestedExpr = job.expr
      let reason = `Shift by ${offset} min to relieve ${col.severity} collision at ${col.windowStart}`

      if (job.kind === 'cron') {
        const parts = job.expr.trim().split(/\s+/)
        if (parts.length === 5 || parts.length === 6) {
          // Adjust the minute field (index 0 for 5-field, 1 for 6-field).
          const minIdx = parts.length === 6 ? 1 : 0
          parts[minIdx] = String(offset)
          suggestedExpr = parts.join(' ')
        }
      } else if (job.kind === 'rate') {
        const parsed = parseRate(job.expr)
        if (parsed) {
          reason = `Stagger start by ${offset} min to avoid overlap with sibling rate jobs`
          suggestedExpr = job.expr // rate itself unchanged; stagger handled by offset
        }
      }

      suggestions.push({ jobId, suggestedExpr, reason })
      handled.add(jobId)
    })
  }

  return suggestions
}
