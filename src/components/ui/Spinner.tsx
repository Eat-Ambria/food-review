// The loading spinner.
export function Spinner({ className = 'size-4', label }: { className?: string; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} aria-label={label}
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80 ${className}`} />
  )
}
