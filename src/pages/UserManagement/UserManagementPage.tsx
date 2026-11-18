// =============================================================================
// WHAT THIS FILE IS
//   Admin → Users: list, search, filter, add, edit, activate/deactivate,
//   reset PIN, unlock, export to CSV, and the entry point to CSV import.
// WHY IT EXISTS
//   It is the single place where the Admin manages who can use the app.
//   Table on desktop, cards on phones.
// USED BY
//   App.tsx route "/admin/users"
// DEPENDS ON
//   services/userAdminService.ts, UserFormModal.tsx
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { listUsers, resetPin, unlockUser } from '../../services/userAdminService'
import { Button, buttonClass } from '../../components/ui/Button'
import { Alert, Card, EmptyState, ListSkeleton, PageHeader } from '../../components/ui/Layout'
import { Toast, useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { FilterSelect, SearchInput } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { Icon } from '../../components/Icon'
import { ROLE_LABEL, rolesLabel, rolesOf, type Role } from '../../types/auth'
import type { ManagedUser } from '../../types/users'
import { downloadCsv, toCsv } from '../../utils/csv'
import { UserFormModal } from './UserFormModal'

type StatusFilter = 'all' | 'active' | 'inactive' | 'locked' | 'default_pin'

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

function StatusBadges({ u }: { u: ManagedUser }) {
  return (
    <div className="flex flex-wrap gap-1">
      {u.is_active ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>}
      {u.locked_until && <Badge tone="danger">Locked</Badge>}
      {u.must_change_pin && <Badge tone="warn">Default PIN</Badge>}
    </div>
  )
}

export function UserManagementPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'unlock'; user: ManagedUser } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [toast, showToast, hideToast] = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try { setUsers(await listUsers()) } catch (e) { setLoadError((e as Error).message) }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const usernames = useMemo(() => new Set(users.map((u) => u.username)), [users])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (q && !u.name.toLowerCase().includes(q) && !u.username.includes(q)) return false
      if (roleFilter !== 'all' && !rolesOf(u).includes(roleFilter)) return false
      if (statusFilter === 'active' && !u.is_active) return false
      if (statusFilter === 'inactive' && u.is_active) return false
      if (statusFilter === 'locked' && !u.locked_until) return false
      if (statusFilter === 'default_pin' && !u.must_change_pin) return false
      return true
    })
  }, [users, query, roleFilter, statusFilter])

  const openAdd = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (u: ManagedUser) => { setEditing(u); setFormOpen(true) }
  const closeForm = useCallback(() => setFormOpen(false), [])

  const runConfirm = async () => {
    if (!confirm) return
    setActionBusy(true)
    try {
      if (confirm.kind === 'reset') {
        await resetPin(confirm.user.id)
        showToast(`PIN reset for ${confirm.user.name}. They sign in with 0000 and must change it.`)
      } else {
        await unlockUser(confirm.user.id)
        showToast(`${confirm.user.name} is unlocked.`)
      }
      setConfirm(null)
      await load()
    } catch (e) {
      showToast((e as Error).message, 'error')
    }
    setActionBusy(false)
  }

  const exportList = () => {
    const csv = toCsv(
      ['Name', 'Username', 'Role', 'Mobile Number', 'Email', 'Status', 'Default PIN', 'Last Login'],
      filtered.map((u) => [u.name, u.username, rolesLabel(u), u.mobile_number, u.email,
        u.is_active ? 'Active' : 'Inactive', u.must_change_pin ? 'Yes' : 'No',
        u.last_login_at ? new Date(u.last_login_at).toISOString() : '']),
    )
    downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const actions = (u: ManagedUser) => (
    <div className="flex flex-wrap justify-end gap-0.5">
      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}><Icon name="pencil" />Edit</Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'reset', user: u })}><Icon name="key" />Reset PIN</Button>
      {u.locked_until && (
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: 'unlock', user: u })}>
          <Icon name="unlock" />Unlock
        </Button>
      )}
    </div>
  )

  const activeCount = users.filter((u) => u.is_active).length
  const defaultPinCount = users.filter((u) => u.must_change_pin).length

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Users"
        description={loading ? 'Loading…' : <>
          <b className="font-semibold text-ink">{users.length}</b> total, <b className="font-semibold text-ink">{activeCount}</b> active
          {defaultPinCount > 0 && <>, <b className="font-semibold text-warn">{defaultPinCount}</b> still on the default PIN</>}
        </>}
        actions={<>
          <Button variant="secondary" onClick={exportList} disabled={!filtered.length}><Icon name="download" />Export</Button>
          <Link to="/admin/users/import" className={buttonClass('secondary')}><Icon name="upload" className="size-4" />Import CSV</Link>
          <Button onClick={openAdd}><Icon name="plus" />Add user</Button>
        </>} />

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name or username" label="Search users" className="sm:flex-1" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <FilterSelect label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'all' | Role)} className="sm:w-40">
            <option value="all">All roles</option>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </FilterSelect>
          <FilterSelect label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="sm:w-40">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="locked">Locked</option>
            <option value="default_pin">Default PIN</option>
          </FilterSelect>
        </div>
      </div>

      {loadError && (
        <Alert tone="danger" className="mt-4" action={<Button variant="secondary" size="sm" onClick={() => void load()}><Icon name="refresh" />Retry</Button>}>
          {loadError}
        </Alert>
      )}

      <div className="mt-5">
        {loading ? (
          <ListSkeleton rows={6} label="Loading users" />
        ) : filtered.length === 0 && !loadError ? (
          users.length
            ? <EmptyState icon="search" title="No users match these filters" description="Try a different name, or clear the role and status filters."
                action={<Button variant="secondary" onClick={() => { setQuery(''); setRoleFilter('all'); setStatusFilter('all') }}><Icon name="x" />Clear filters</Button>} />
            : <EmptyState icon="users" title="No users yet" description="Add people one by one, or import everyone from a CSV file."
                action={<div className="flex gap-2"><Link to="/admin/users/import" className={buttonClass('secondary')}><Icon name="upload" className="size-4" />Import CSV</Link><Button onClick={openAdd}><Icon name="plus" />Add user</Button></div>} />
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden overflow-hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-subtle text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Last login</th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((u) => (
                    <tr key={u.id} className={`group transition-colors hover:bg-subtle/70 ${u.is_active ? '' : 'text-muted'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${u.is_active ? 'bg-ink/[0.07] text-ink' : 'bg-ink/[0.04] text-faint'}`}>{initials(u.name)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-medium text-muted">(you)</span>}</p>
                            <p className="truncate text-xs text-muted">{u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{rolesLabel(u)}</td>
                      <td className="px-4 py-3"><StatusBadges u={u} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted tabular-nums">{fmtDate(u.last_login_at)}</td>
                      <td className="px-3 py-2">{actions(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Mobile cards */}
            <Card className="divide-y divide-line overflow-hidden md:hidden">
              {filtered.map((u) => (
                <div key={u.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-xs font-bold">{initials(u.name)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-medium text-muted">(you)</span>}</p>
                      <p className="truncate text-xs text-muted">{u.username} · {rolesLabel(u)}</p>
                      <div className="mt-2"><StatusBadges u={u} /></div>
                      <p className="mt-2 text-xs text-faint">Last login: {fmtDate(u.last_login_at)}</p>
                    </div>
                  </div>
                  <div className="-mx-1 mt-2 [&>div]:justify-start">{actions(u)}</div>
                </div>
              ))}
            </Card>
          </>
        )}
      </div>

      <UserFormModal open={formOpen} user={editing} existingUsernames={usernames} onClose={closeForm}
        onSaved={(msg) => { setFormOpen(false); showToast(msg); void load() }} />

      <Modal open={Boolean(confirm)} title={confirm?.kind === 'reset' ? 'Reset PIN?' : 'Unlock user?'} onClose={() => setConfirm(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button loading={actionBusy} onClick={() => void runConfirm()}>
            {confirm?.kind === 'reset' ? 'Reset to 0000' : 'Unlock'}
          </Button>
        </>}>
        <p className="text-sm leading-relaxed text-muted">
          {confirm?.kind === 'reset'
            ? <><b className="text-ink">{confirm.user.name}</b>&rsquo;s PIN will become <b className="text-ink">0000</b>. They must set a new PIN at their next sign-in. Any lock is also cleared.</>
            : <><b className="text-ink">{confirm?.user.name}</b> will be able to try signing in again right away.</>}
        </p>
      </Modal>

      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
}
