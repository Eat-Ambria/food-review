// =============================================================================
// WHAT THIS FILE IS
//   The Ambria Issue Desk logo: the gold cloche + checklist tile on navy.
// WHY IT EXISTS
//   One logo everywhere inside the app (sidebar, phone top bar, login page).
//   It is the same picture as the app icons and favicon: all of them are made
//   from scripts/icon-source.png by scripts/icons_from_image.py
//   (npm run icons), which writes public/brand-mark.png for this component.
// USED BY
//   layouts/AppLayout.tsx, pages/Login/LoginPage.tsx
// =============================================================================

export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <img src={`${import.meta.env.BASE_URL}brand-mark.png`} alt="" aria-hidden="true" draggable={false}
      className={`select-none object-contain ${className}`} />
  )
}
