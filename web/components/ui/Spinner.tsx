interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <span className={`inline-flex items-center gap-2 text-slate-400 ${className}`}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-lime-400" />
      {label && <span className="text-sm">{label}</span>}
    </span>
  )
}

export function PageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export default Spinner
