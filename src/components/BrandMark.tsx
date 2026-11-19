// Shows the Ambria food review logo.
export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <img src={`${import.meta.env.BASE_URL}brand-mark.png`} alt="" aria-hidden="true" draggable={false}
      className={`select-none object-contain ${className}`} />
  )
}
