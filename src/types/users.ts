// Types for user management and the CSV import.
import type { Role } from './auth'

export interface ManagedUser {
  id: string
  name: string
  username: string
  role: Role
  roles: Role[]
  mobile_number: string | null
  email: string | null
  is_active: boolean
  must_change_pin: boolean
  last_login_at: string | null
  created_at: string
  locked_until: string | null
}

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

export type RowState = 'ready' | 'warning' | 'error' | 'blank'

export interface PreviewRow {
  index: number
  lineNumber: number
  name: string
  username: string
  usernameWasGenerated: boolean
  role: Role
  mobile_number: string | null
  email: string | null
  include: boolean
  state: RowState
  parseErrors: string[]
  parseNotes: string[]
  messages: { text: string; level: 'error' | 'warning' }[]
}

export type ImportOutcome = 'imported' | 'skipped' | 'failed'

export interface ImportResultRow {
  lineNumber: number
  name: string
  username: string
  outcome: ImportOutcome
  reason: string
}
