// =============================================================================
// WHAT THIS FILE IS
//   TypeScript types for Vite and for our VITE_ environment variables.
// WHY IT EXISTS
//   It makes import.meta.env.VITE_SUPABASE_URL typed, so a typo becomes a
//   compile error instead of an undefined value at runtime.
// =============================================================================
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_VAPID_PUBLIC_KEY?: string     // Web Push public key (public; the private one is a server secret)
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
