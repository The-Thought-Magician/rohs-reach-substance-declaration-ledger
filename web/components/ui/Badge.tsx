import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'lime'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-600/40',
  danger: 'bg-red-500/15 text-red-300 border-red-600/40',
  info: 'bg-sky-500/15 text-sky-300 border-sky-600/40',
  lime: 'bg-lime-500/15 text-lime-300 border-lime-600/40',
}

// Maps common compliance status strings to a tone so pages can pass a raw status.
export function statusTone(status?: string): Tone {
  switch ((status ?? '').toLowerCase().replace(/[_\s]+/g, '-')) {
    case 'compliant':
    case 'pass':
    case 'received':
    case 'validated':
    case 'active':
      return 'success'
    case 'at-risk':
    case 'expiring':
    case 'reminded':
    case 'requested':
    case 'pending':
      return 'warning'
    case 'non-compliant':
    case 'fail':
    case 'rejected':
    case 'expired':
      return 'danger'
    case 'incomplete-data':
    case 'incomplete':
    case 'draft':
      return 'info'
    default:
      return 'neutral'
  }
}

export function Badge({ tone = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
