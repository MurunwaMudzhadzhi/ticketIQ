/**
 * TicketIQ — Sidebar Navigation
 * ===============================
 * The fixed left-hand nav shown inside DashboardLayout. Which links
 * appear, and what each one is labelled, depends entirely on the
 * logged-in user's role — navByRole and roleDisplayInfo below are the
 * two lookup tables that drive that. Adding a new role anywhere in the
 * app means adding an entry to both of these, or that role's sidebar
 * will silently fall back to the plain "employee" nav (see the
 * `|| navByRole.employee` fallback below).
 */
'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Zap, LayoutDashboard, Ticket, BarChart3, Users, Settings,
  LogOut, Building2, ChevronRight, Cpu, Shield, Plus, HeadphonesIcon
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/lib/api'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// Which nav links show up for each role, in display order. Agents
// (ai_intern / it_support_technician / junior_operations) each get a
// queue label naming their specific department(s), even though all
// three actually point at the same /tickets route — the ticket list
// page itself filters by who's logged in (see ticket_service.py's
// get_tickets_for_user on the backend), so the label is purely
// cosmetic context, not a different route per role.
const navByRole: Record<string, { href: string; icon: any; label: string }[]> = {
  employee: [
    { href: '/dashboard/employee', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/tickets',            icon: Ticket,          label: 'My Tickets' },
    { href: '/tickets/new',        icon: Plus,            label: 'Submit Ticket' },
  ],
  ai_intern: [
    { href: '/dashboard/agent',    icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/tickets',            icon: Ticket,          label: 'HR Queue' },
    { href: '/analytics/admin',    icon: BarChart3,       label: 'Analytics' },
  ],
  it_support_technician: [
    { href: '/dashboard/agent',    icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/tickets',            icon: Ticket,          label: 'IT & Finance Queue' },
    { href: '/analytics/admin',    icon: BarChart3,       label: 'Analytics' },
  ],
  junior_operations: [
    { href: '/dashboard/agent',    icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/tickets',            icon: Ticket,          label: 'Operations Queue' },
    { href: '/analytics/admin',    icon: BarChart3,       label: 'Analytics' },
  ],
  admin: [
    { href: '/dashboard/admin',    icon: LayoutDashboard, label: 'Admin Dashboard' },
    { href: '/tickets',            icon: Ticket,          label: 'All Tickets' },
    { href: '/admin/users',        icon: Users,           label: 'Users' },
    { href: '/admin/departments',  icon: Building2,       label: 'Department Reports' },
    { href: '/analytics/admin',    icon: BarChart3,       label: 'Analytics' },
    { href: '/admin/settings',     icon: Settings,        label: 'Settings' },
  ],
  super_admin: [
    { href: '/dashboard/admin',    icon: Shield,          label: 'Admin Dashboard' },
    { href: '/tickets',            icon: Ticket,          label: 'All Tickets' },
    { href: '/admin/users',        icon: Users,           label: 'Users' },
    { href: '/admin/departments',  icon: Building2,       label: 'Department Reports' },
    { href: '/analytics/admin',    icon: BarChart3,       label: 'Analytics' },
    { href: '/admin/settings',     icon: Settings,        label: 'Settings' },
  ],
}

// Cosmetic display info (badge label, colour, and which department(s)
// an agent role handles) shown just below the logo — purely visual,
// has no effect on routing or permissions.
const roleDisplayInfo: Record<string, { label: string; color: string; depts?: string }> = {
  employee:              { label: 'Employee',               color: 'text-cyan-400 bg-cyan-400/10' },
  ai_intern:             { label: 'AI Intern',              color: 'text-purple-400 bg-purple-400/10', depts: 'HR' },
  it_support_technician: { label: 'IT Support Technician',  color: 'text-blue-400 bg-blue-400/10',    depts: 'IT · Finance' },
  junior_operations:     { label: 'Junior Operations',      color: 'text-amber-400 bg-amber-400/10',  depts: 'Operations' },
  admin:                 { label: 'Administrator',          color: 'text-blue-400 bg-blue-400/10' },
  super_admin:           { label: 'Super Admin',            color: 'text-red-400 bg-red-400/10' },
}

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, clearAuth, refresh_token } = useAuthStore()

  const roleKey = user?.role || 'employee'
  const navItems = navByRole[roleKey] || navByRole.employee
  const info = roleDisplayInfo[roleKey] || { label: roleKey, color: 'text-gray-400 bg-gray-400/10' }

  const handleLogout = async () => {
    // Best-effort: tell the backend to revoke this refresh token (see
    // POST /auth/logout), but don't block logging out locally if that
    // call fails for any reason (e.g. the backend is briefly
    // unreachable) — the user should always be able to log out of
    // their own browser regardless of server state.
    try { if (refresh_token) await authApi.logout(refresh_token) } catch {}
    clearAuth()
    router.push('/login')
    toast.success('Logged out successfully')
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-gray-950 border-r border-gray-800/60 flex flex-col z-40">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-gray-800/60">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="font-bold text-white text-sm">TicketIQ</span>
          <p className="text-xs text-gray-500">Enterprise</p>
        </div>
      </div>

      {/* Role badge */}
      <div className="px-4 py-3 border-b border-gray-800/60 space-y-1">
        <div className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', info.color)}>
          <Cpu className="w-3 h-3" />
          {info.label}
        </div>
        {info.depts && (
          <p className="text-xs text-gray-600 pl-1">Handles: <span className="text-gray-500">{info.depts}</span></p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          {/* Matches either an exact path, or any sub-path beneath it
              (e.g. "/tickets/abc123" should still highlight the
              "/tickets" nav item) — the startsWith check with a
              trailing slash is what makes nested routes highlight
              their parent's nav entry correctly. */}
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                whileHover={{ x: 2 }}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all',
                  active
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                {active && <ChevronRight className="w-3 h-3" />}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="border-t border-gray-800/60 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.full_name?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
