// =============================================================================
// WHAT THIS FILE IS
//   Types for the Admin User Management screens and the CSV import.
// WHY IT EXISTS
//   Gives the user list, the add/edit form and the import preview one shared
//   vocabulary.
// USED BY
//   services/userAdminService.ts, services/csvImportService.ts, pages/UserManagement/*
// =============================================================================
import type { Role } from './auth'

/** A row from admin_list_users(). */
export interface ManagedUser {
  id: string
  name: string
  username: string
  role: Role          // primary role
  roles: Role[]       // every role
  mobile_number: string | null
  email: string | null
  is_active: boolean
  must_change_pin: boolean
  last_login_at: string | null
  created_at: string
  locked_until: string | null
}

/** What gets sent to the admin-users Edge Function for each new user. */
export interface NewUserInput {
  index: number
  name: string
  username: string
  roles: Role[]
  mobile_number: string | null
  email: string | null
}

export interface CreateResult {
  index: number
  ok: boolean
  user_id?: string
  username?: string
  error?: string
}

// ---- CSV import preview ------------------------------------------------------

/**
 * ready   → will be imported
 * warning → can be imported, but the admin should look at it first
 * error   → cannot be imported until fixed (e.g. invalid username)
 * blank   → empty line in the file, always skipped
 */
export type RowState = 'ready' | 'warning' | 'error' | 'blank'

export interface PreviewRow {
  index: number          // 0-based position in the preview
  lineNumber: number     // line in the CSV file (header = line 1)
  name: string
  username: string
  usernameWasGenerated: boolean
  role: Role
  mobile_number: string | null
  email: string | null
  include: boolean       // admin's tick-box
  state: RowState
  parseErrors: string[]  // fixed problems found while reading the file
  parseNotes: string[]   // fixed warnings found while reading the file (e.g. role)
  messages: { text: string; level: 'error' | 'warning' }[]  // shown in the preview, recalculated after every edit
}

export type ImportOutcome = 'imported' | 'skipped' | 'failed'

export interface ImportResultRow {
  lineNumber: number
  name: string
  username: string
  outcome: ImportOutcome
  reason: string
}
