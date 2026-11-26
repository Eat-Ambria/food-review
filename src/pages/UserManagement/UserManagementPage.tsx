// Admin page to list, add, edit, deactivate, reset the PIN of and unlock users.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { deleteUser, listUsers, resetPin, unlockUser, updateUser } from '../../services/userAdminService'
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
import { personName } from '../../utils/personName'

type StatusFilter = 'all' | 'active' | 'inactive' | 'locked' | 'default_pin'

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}


const ROLE_ORDER: Role[] = ['admin', 'recorder', 'poc']
const ROLE_TONE: Record<Role, string> = {
  admin: 'bg-navy-800 text-white',
  recorder: 'bg-[#fbecc7] text-[#7a5408]',
  poc: 'bg-sky-100 text-sky-800',
}
function RoleChips({ u }: { u: ManagedUser }) {
  const mine = rolesOf(u)
  return (
    <div className="flex flex-wrap gap-1">
      {ROLE_ORDER.filter((r) => mine.includes(r)).map((r) => (
        <span key={r} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_TONE[r]}`}>{ROLE_LABEL[r]}</span>
      ))}
    </div>
  )
}

function StatusBadges({ u }: { u: ManagedUser }) {
  return (
    <div className="flex flex-wrap gap-1">
      {u.is_active ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>}
      {u.locked_until && <Badge tone="danger">Locked</Badge>}
      {u.must_change_pin && <Badge tone="warn">Default PIN</Badge>}
    </div>
  )
}

const CONFIRM_TITLE = { reset: 'Reset PIN?', unlock: 'Unlock user?', delete: 'Delete user?', deactivate: 'Cannot delete this user' } as const
const CONFIRM_BUTTON = { reset: 'Reset to 0000', unlock: 'Unlock', delete: 'Delete', deactivate: 'Deactivate' } as const

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
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'unlock' | 'delete' | 'deactivate'; user: ManagedUser } | null>(null)
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
      if (confirm.kind === 'delete') {
        const res = await deleteUser(confirm.user.id)
        if (!res.ok) {
          if (res.hasHistory && confirm.user.is_active) { setConfirm({ kind: 'deactivate', user: confirm.user }); setActionBusy(false); return }
          throw new Error(res.error)
        }
        showToast(`${personName(confirm.user.name)} is deleted.`)
      } else if (confirm.kind === 'deactivate') {
        const u = confirm.user
        const res = await updateUser({ id: u.id, name: u.name, username: u.username, roles: u.roles,
          mobile_number: u.mobile_number, email: u.email, is_active: false })
        if (!res.ok) throw new Error(res.error ?? 'Could not deactivate the user.')
        showToast(`${personName(u.name)} is deactivated and can no longer sign in.`)
      } else if (confirm.kind === 'reset') {
        await resetPin(confirm.user.id)
        showToast(`PIN reset for ${personName(confirm.user.name)}. They sign in with 0000 and must change it.`)
      } else {
        await unlockUser(confirm.user.id)
        showToast(`${personName(confirm.user.name)} is unlocked.`)
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
    <div className="flex shrink-0 justify-end gap-0.5">
      <Button variant="ghost" size="sm" onClick={() => openEdit(u)}><Icon name="pencil" />Edit</Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'reset', user: u })}><Icon name="key" />Reset PIN</Button>
      {u.locked_until && (
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: 'unlock', user: u })}>
          <Icon name="unlock" />Unlock
        </Button>
      )}
      {u.id !== me?.id && (
        <Button variant="ghost" size="sm" aria-label={`Delete ${personName(u.name)}`} title="Delete user"
          className="hover:bg-danger-soft! hover:text-danger!" onClick={() => setConfirm({ kind: 'delete', user: u })}>
          <Icon name="trash" /><span className="max-xl:hidden">Delete</span>
        </Button>
      )}
    </div>
  )

  const activeCount = users.filter((u) => u.is_active).length
  const defaultPinCount = users.filter((u) => u.must_change_pin).length

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Users" wideActions
        description={loading ? 'Loading…' : <>
          <b className="font-semibold text-ink">{users.length}</b> total, <b className="font-semibold text-ink">{activeCount}</b> active
          {defaultPinCount > 0 && <>, <b className="font-semibold text-warn">{defaultPinCount}</b> still on the default PIN</>}
        </>}
        actions={

          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" onClick={exportList} disabled={!filtered.length} className="px-2 sm:px-4"><Icon name="download" />Export</Button>
            <Link to="/admin/users/import" className={buttonClass('secondary', 'md', 'px-2 sm:px-4')}><Icon name="upload" className="size-4" />Import<span className="hidden sm:inline">&nbsp;CSV</span></Link>
            <Button onClick={openAdd} className="px-2 sm:px-4"><Icon name="plus" />Add<span className="hidden sm:inline">&nbsp;user</span></Button>
          </div>
        } />

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

            <Card className="hidden overflow-hidden xl:block">
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
                        <div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{personName(u.name)}{u.id === me?.id && <span className="ml-1.5 text-xs font-medium text-muted">(you)</span>}</p>
                            <p className="truncate text-xs text-muted">{u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><RoleChips u={u} /></td>
                      <td className="px-4 py-3"><StatusBadges u={u} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted tabular-nums">{fmtDate(u.last_login_at)}</td>
                      <td className="px-3 py-2">{actions(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="@container xl:hidden"><div className="grid gap-3 @3xl:grid-cols-2">
              {filtered.map((u) => (
                <Card key={u.id} className={`flex flex-col overflow-hidden ${u.is_active ? '' : 'opacity-75'}`}>
                  <div className="flex flex-1 items-start p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold leading-tight">
                        {personName(u.name)}{u.id === me?.id && <span className="ml-1.5 text-xs font-medium text-muted">(you)</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-muted">@{u.username}{u.is_active ? '' : ' · Inactive'}</p>
                      <div className="mt-2.5"><RoleChips u={u} /></div>
                      {(u.locked_until || u.must_change_pin) && (
                        <p className={`mt-2 text-xs ${u.locked_until ? 'font-semibold text-danger' : 'text-muted'}`}>
                          {u.locked_until ? 'Locked after wrong PINs' : 'Still on the default PIN'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-line bg-subtle/60 py-1.5 pl-4 pr-1.5">
                    <p className="min-w-0 truncate text-xs text-muted" title={u.last_login_at ? `Last sign-in ${fmtDate(u.last_login_at)}` : undefined}>
                      {u.last_login_at
                        ? <>Last sign-in <span className="font-semibold text-ink/75">{new Date(u.last_login_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></>
                        : 'Never signed in'}
                    </p>
                    {actions(u)}
                  </div>
                </Card>
              ))}
            </div></div>
          </>
        )}
      </div>

      <UserFormModal open={formOpen} user={editing} existingUsernames={usernames} onClose={closeForm}
        onSaved={(msg) => { setFormOpen(false); showToast(msg); void load() }} />

      <Modal open={Boolean(confirm)} title={CONFIRM_TITLE[confirm?.kind ?? 'reset']} onClose={() => setConfirm(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button loading={actionBusy} variant={confirm?.kind === 'delete' || confirm?.kind === 'deactivate' ? 'danger' : 'primary'} onClick={() => void runConfirm()}>
            {CONFIRM_BUTTON[confirm?.kind ?? 'reset']}
          </Button>
        </>}>
        <p className="text-sm leading-relaxed text-muted">
          {confirm?.kind === 'delete'
            ? <><b className="text-ink">{personName(confirm.user.name)}</b> ({confirm.user.username}) will be removed and can no longer sign in. This cannot be undone.</>
            : confirm?.kind === 'deactivate'
            ? <><b className="text-ink">{personName(confirm.user.name)}</b> has history in the app, such as recorded complaints, so they cannot be deleted without losing it. Deactivate them instead: they can no longer sign in, and their history stays in the reports.</>
            : confirm?.kind === 'reset'
            ? <><b className="text-ink">{personName(confirm.user.name)}</b>&rsquo;s PIN will become <b className="text-ink">0000</b>. They must set a new PIN at their next sign-in. Any lock is also cleared.</>
            : <><b className="text-ink">{personName(confirm?.user.name)}</b> will be able to try signing in again right away.</>}
        </p>
      </Modal>

      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
}
