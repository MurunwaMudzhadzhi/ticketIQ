/**
 * TicketIQ — Admin: User Management
 * =====================================
 * Lets admins view, search, filter, create, edit, and activate/deactivate
 * every account in the system. Backed entirely by adminApi (see
 * api/v1/endpoints/admin.py) — every action here is admin-only on the
 * backend too (the AdminOnly dependency), so this page being
 * `requiredRoles={['admin','super_admin']}`-gated is a UX convenience,
 * not the actual security boundary.
 */
'use client'
import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/shared/DashboardLayout'
import { adminApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Plus, Search, X, Check, ChevronDown,
  Shield, Cpu, Wrench, UserCheck, Ban, Pencil, AlertCircle
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// ── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string
  email: string
  full_name: string
  role: string
  employee_id: string | null
  department_id: string | null
  department_name: string | null
  agent_role_key: string | null
  job_title: string | null
  is_active: boolean
  created_at: string
}

interface Department {
  id: string
  name: string
  slug: string
  color: string
}

// ── Constants ────────────────────────────────────────────────────────────────

// Every selectable role in the "create/edit user" form, with display
// label, badge colour, and icon — must stay in sync with the UserRole
// enum in the backend's models.py.
const ROLES = [
  { value: 'employee',              label: 'Employee',              color: 'text-cyan-400   bg-cyan-400/10',   icon: UserCheck },
  { value: 'ai_intern',             label: 'AI Intern',             color: 'text-purple-400 bg-purple-400/10', icon: Cpu },
  { value: 'it_support_technician', label: 'IT Support Technician', color: 'text-blue-400   bg-blue-400/10',   icon: Wrench },
  { value: 'junior_operations',     label: 'Junior Operations',     color: 'text-amber-400  bg-amber-400/10',  icon: Wrench },
  { value: 'admin',                 label: 'Administrator',         color: 'text-blue-400   bg-blue-400/10',   icon: Shield },
  { value: 'super_admin',           label: 'Super Admin',           color: 'text-red-400    bg-red-400/10',    icon: Shield },
]

const AGENT_ROLES = ['ai_intern', 'it_support_technician', 'junior_operations']

/** Looks up display metadata (label/colour/icon) for a role value, falling back to a plain grey badge for any unrecognised role. */
function roleMeta(role: string) {
  return ROLES.find(r => r.value === role) ?? { label: role, color: 'text-gray-400 bg-gray-400/10', icon: UserCheck }
}

// ── Role Badge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const m = roleMeta(role)
  const Icon = m.icon
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full', m.color)}>
      <Icon className="w-3 h-3" />
      {m.label}
    </span>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Shared modal for both creating a new user AND editing an existing
// one — `isEdit` (derived from whether a `user` prop was passed)
// drives which fields show: email/password/employee_id only appear on
// create (since those are typically set once and not changed casually
// through this form), and role becomes locked/disabled once editing
// (changing someone's role is treated as a bigger action than this
// quick-edit modal is meant for).

interface ModalProps {
  user?: User | null
  departments: Department[]
  onClose: () => void
  onSaved: () => void
}

function UserModal({ user, departments, onClose, onSaved }: ModalProps) {
  const isEdit = !!user
  const [form, setForm] = useState({
    full_name:    user?.full_name    ?? '',
    email:        user?.email        ?? '',
    password:     '',
    role:         user?.role         ?? 'employee',
    job_title:    user?.job_title    ?? '',
    employee_id:  user?.employee_id  ?? '',
    department_id: user?.department_id ?? '',
    agent_role_key: user?.agent_role_key ?? '',
  })
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState('')

  const isAgent = AGENT_ROLES.includes(form.role)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (isEdit) {
        const patch: Record<string, any> = {
          full_name:      form.full_name,
          job_title:      form.job_title,
          agent_role_key: isAgent ? form.agent_role_key || form.role : null,
        }
        await adminApi.updateUser(user!.id, patch)
        toast.success('User updated')
      } else {
        await adminApi.createUser({
          full_name:      form.full_name,
          email:          form.email,
          password:       form.password,
          role:           form.role,
          job_title:      form.job_title || undefined,
          employee_id:    form.employee_id || undefined,
          department_id:  form.department_id || undefined,
          agent_role_key: isAgent ? form.agent_role_key || form.role : undefined,
        })
        toast.success('User created')
      }
      onSaved()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative w-full max-w-lg glass-card rounded-2xl border border-gray-700/60 p-6 z-10"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-white">{isEdit ? 'Edit User' : 'Create User'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{isEdit ? `Editing ${user!.full_name}` : 'Add a new user to the system'}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">Full Name</label>
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
          </div>

          {/* Email + Password — only on create */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">Password</label>
                <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
              </div>
            </div>
          )}

          {/* Role */}
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">Role</label>
            <div className="relative">
              <select value={form.role} onChange={e => set('role', e.target.value)}
                disabled={isEdit}
                className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition disabled:opacity-50">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            </div>
          </div>

          {/* Job title + Employee ID */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block">Job Title</label>
              <input value={form.job_title} onChange={e => set('job_title', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
            </div>
            {!isEdit && (
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">Employee ID</label>
                <input value={form.employee_id} onChange={e => set('employee_id', e.target.value)}
                  placeholder="EMP-0001"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
              </div>
            )}
          </div>

          {/* Department — employees only */}
          {!isEdit && !isAgent && form.role === 'employee' && (
            <div>
              <label className="text-xs font-medium text-gray-400 mb-1.5 block">Department</label>
              <div className="relative">
                <select value={form.department_id} onChange={e => set('department_id', e.target.value)}
                  className="w-full appearance-none bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition">
                  <option value="">— None —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-2.5 text-sm font-medium transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition flex items-center justify-center gap-2">
              {saving
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                : <><Check className="w-4 h-4" /> {isEdit ? 'Save Changes' : 'Create User'}</>}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [users,       setUsers]       = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [roleFilter,  setRoleFilter]  = useState('all')
  const [modal,       setModal]       = useState<'create' | 'edit' | null>(null)
  const [selected,    setSelected]    = useState<User | null>(null)
  const [toggling,    setToggling]    = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([adminApi.listUsers(), adminApi.listDepartments()])
      .then(([u, d]) => { setUsers(u.data); setDepartments(d.data) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Deactivating a user (rather than deleting them) preserves their
  // history — any tickets they submitted, were assigned, or commented
  // on stay intact; is_active=false just blocks them from logging in
  // (see authenticate_user() in the backend's auth_service.py, which
  // filters on is_active).
  const handleToggleActive = async (u: User) => {
    setToggling(u.id)
    try {
      await adminApi.updateUser(u.id, { is_active: !u.is_active })
      toast.success(`${u.full_name} ${u.is_active ? 'deactivated' : 'activated'}`)
      load()
    } catch {
      toast.error('Failed to update user')
    } finally {
      setToggling(null)
    }
  }

  // Client-side search + role filter over the full user list — fine at
  // typical org headcount, would need server-side filtering/pagination
  // for a much larger user base.
  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.employee_id ?? '').toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    return matchSearch && matchRole
  })

  const counts = {
    total:    users.length,
    active:   users.filter(u => u.is_active).length,
    agents:   users.filter(u => AGENT_ROLES.includes(u.role)).length,
    admins:   users.filter(u => ['admin', 'super_admin'].includes(u.role)).length,
  }

  return (
    <DashboardLayout title="User Management" subtitle="Manage accounts, roles and access" requiredRoles={['admin', 'super_admin']}>
      <div className="space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Users',    value: counts.total,   color: 'text-blue-400',   bg: 'bg-blue-500/10' },
            { label: 'Active',         value: counts.active,  color: 'text-green-400',  bg: 'bg-green-500/10' },
            { label: 'Support Agents', value: counts.agents,  color: 'text-purple-400', bg: 'bg-purple-500/10' },
            { label: 'Admins',         value: counts.admins,  color: 'text-amber-400',  bg: 'bg-amber-500/10' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="glass-card rounded-xl p-4 border border-gray-800/60">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={clsx('text-2xl font-bold', s.color)}>{s.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Table card */}
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between px-5 py-4 border-b border-gray-800/60">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, email, ID…"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Role filter */}
              <div className="relative">
                <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
                  className="appearance-none bg-gray-900 border border-gray-700 rounded-lg pl-3 pr-8 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition">
                  <option value="all">All Roles</option>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              </div>
            </div>

            <button
              onClick={() => { setSelected(null); setModal('create') }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition flex-shrink-0">
              <Plus className="w-4 h-4" /> Add User
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="py-16 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Users className="w-8 h-8 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/60 bg-gray-900/40">
                    {['User', 'Role', 'Department', 'Employee ID', 'Job Title', 'Status', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {filtered.map((u, i) => (
                    <motion.tr key={u.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                      className="hover:bg-gray-900/40 transition">

                      {/* User */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={clsx(
                            'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
                            u.is_active ? 'bg-gradient-to-br from-blue-500 to-purple-600' : 'bg-gray-700'
                          )}>
                            {u.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-white font-medium text-sm truncate">{u.full_name}</p>
                            <p className="text-xs text-gray-500 truncate">{u.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3"><RoleBadge role={u.role} /></td>

                      {/* Department */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">{u.department_name ?? <span className="text-gray-600">—</span>}</span>
                      </td>

                      {/* Employee ID */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-gray-500">{u.employee_id ?? '—'}</span>
                      </td>

                      {/* Job Title */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">{u.job_title ?? '—'}</span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full',
                          u.is_active ? 'bg-green-500/10 text-green-400' : 'bg-gray-700/60 text-gray-500'
                        )}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', u.is_active ? 'bg-green-400' : 'bg-gray-500')} />
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setSelected(u); setModal('edit') }}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition"
                            title="Edit user">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(u)}
                            disabled={toggling === u.id}
                            className={clsx(
                              'p-1.5 rounded-lg transition',
                              u.is_active
                                ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'
                                : 'text-gray-500 hover:text-green-400 hover:bg-green-500/10'
                            )}
                            title={u.is_active ? 'Deactivate user' : 'Activate user'}>
                            {toggling === u.id
                              ? <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                              : u.is_active ? <Ban className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer count */}
          {!loading && filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-800/60 text-xs text-gray-600">
              Showing {filtered.length} of {users.length} users
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modal && (
          <UserModal
            user={modal === 'edit' ? selected : null}
            departments={departments}
            onClose={() => { setModal(null); setSelected(null) }}
            onSaved={() => { setModal(null); setSelected(null); load() }}
          />
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}
