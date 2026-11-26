// The Add User / Edit User dialog.
import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { ChoiceRow, TextField } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Layout'
import { Icon } from '../../components/Icon'
import { ROLE_LABEL, ROLE_ORDER, rolesOf, type Role } from '../../types/auth'

const ROLE_HINT: Record<Role, string> = {
  admin: 'Manages users, venues, POCs and sees every issue',
  recorder: 'Records complaints and sees their own submissions',
  poc: 'Receives issues for their department and resolves them',
}
import type { ManagedUser } from '../../types/users'
import { createUsers, updateUser } from '../../services/userAdminService'
import { usernameFromName } from '../../services/csvImportService'

export function UserFormModal({ open, user, existingUsernames, onClose, onSaved }: {
  open: boolean
  user: ManagedUser | null
  existingUsernames: Set<string>
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [roles, setRoles] = useState<Role[]>(['recorder'])
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(user?.name ?? '')
    setUsername(user?.username ?? '')
    setUsernameTouched(Boolean(user))
    setRoles(user ? rolesOf(user) : ['recorder'])
    setMobile(user?.mobile_number ?? '')
    setEmail(user?.email ?? '')
    setActive(user?.is_active ?? true)
    setError(null)
  }, [open, user])

  const onNameChange = (v: string) => {
    setName(v)
    if (!usernameTouched) {
      const base = usernameFromName(v)
      let candidate = base
      for (let n = 2; candidate && existingUsernames.has(candidate); n++) candidate = `${base}${n}`
      setUsername(candidate)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    const uname = username.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!name.trim()) { setError('Name is required.'); return }
    if (!/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(uname)) {
      setError('Username can only use lowercase letters, numbers and dots (e.g. rahul.sharma).'); return
    }
    if (roles.length === 0) { setError('Choose at least one role.'); return }
    setBusy(true)
    if (user) {
      const res = await updateUser({ id: user.id, name, username: uname, roles,
        mobile_number: mobile || null, email: email || null, is_active: active })
      setBusy(false)
      if (!res.ok) { setError(res.error ?? 'Could not save.'); return }
      onSaved(`Saved changes for ${name.trim()}.`)
    } else {
      const [res] = await createUsers([{ index: 0, name: name.trim(), username: uname, roles,
        mobile_number: mobile || null, email: email || null }])
      setBusy(false)
      if (!res?.ok) { setError(res?.error ?? 'Could not create user.'); return }
      onSaved(`Created ${name.trim()}. Username: ${uname}, PIN: 0000.`)
    }
  }

  return (
    <Modal open={open} title={user ? 'Edit user' : 'Add user'} onClose={onClose}
      description={user ? `@${user.username}` : 'They sign in with PIN 0000 and must change it on first login.'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="user-form" loading={busy}>{user ? 'Save changes' : 'Create user'}</Button>
      </>}>
      <form id="user-form" onSubmit={submit} className="space-y-5" noValidate>
        <TextField label="Full name" value={name} onChange={(e) => onNameChange(e.target.value)} autoFocus maxLength={120} />
        <TextField label="Username" value={username} autoCapitalize="none" spellCheck={false} maxLength={64}
          onChange={(e) => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/^ +/, '').replace(/ {2,}/g, ' ')); setUsernameTouched(true) }}
          hint="Used to sign in. Small letters, numbers and spaces. Staff can also sign in with just their first name." />
        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold">Roles <span className="font-normal text-muted">(one or more)</span></legend>
          <div className="space-y-2">
            {ROLE_ORDER.map((r) => (
              <ChoiceRow key={r} checked={roles.includes(r)} title={ROLE_LABEL[r]} description={ROLE_HINT[r]}
                onChange={(on) => setRoles((prev) => on ? [...prev, r] : prev.filter((x) => x !== r))} />
            ))}
          </div>
          {roles.includes('admin') && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warn"><Icon name="alert" className="size-3.5" />Admins can manage all users and see every issue.</p>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Mobile (optional)" value={mobile} inputMode="tel" maxLength={20} onChange={(e) => setMobile(e.target.value)} />
          <TextField label="Email (optional)" value={email} type="email" maxLength={200} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {user && (
          <ChoiceRow checked={active} onChange={setActive} title="Active"
            description="Inactive users cannot sign in, and lose access to all data straight away." />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  )
}
