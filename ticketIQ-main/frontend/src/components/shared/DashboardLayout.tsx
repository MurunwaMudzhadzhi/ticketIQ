/**
 * TicketIQ — Dashboard Layout Shell
 * ====================================
 * The shared page chrome wrapping every authenticated page: a fixed
 * Sidebar on the left, a Header bar across the top, and the page's own
 * content (`children`) scrollable underneath. Every dashboard/admin
 * page in the app renders inside this, passing it a title/subtitle and
 * (optionally) which roles are allowed to view that specific page.
 *
 * This is also where route protection actually happens — see the
 * useEffect below. A page doesn't need its own auth check; it just
 * wraps its content in <DashboardLayout requiredRoles={[...]}> and
 * this component handles redirecting anyone who shouldn't be there.
 */
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuthStore } from '@/stores/authStore'

interface Props {
  children: React.ReactNode
  title: string
  subtitle?: string
  requiredRoles?: string[]
}

/**
 * Maps a user's role to THEIR OWN correct dashboard — used as the
 * fallback redirect target when requiredRoles rejects them. This
 * mirrors get_redirect_url() in the backend (services/auth/auth_service.py)
 * and the redirect logic in app/page.tsx; all three should stay in sync
 * if a new role is ever added.
 *
 * Using this (rather than always redirecting to "/dashboard/admin")
 * matters: a hardcoded admin-page fallback would send a rejected
 * employee to a page THEY ALSO can't access, which has its own
 * requiredRoles check that would reject them again — bouncing them
 * back and forth in an infinite redirect loop instead of landing them
 * somewhere they're actually allowed to be.
 */
function getOwnDashboardPath(role: string | undefined): string {
  if (role === 'admin' || role === 'super_admin') return '/dashboard/admin'
  if (role === 'ai_intern' || role === 'it_support_technician' || role === 'junior_operations') return '/dashboard/agent'
  return '/dashboard/employee'
}

export default function DashboardLayout({ children, title, subtitle, requiredRoles }: Props) {
  const router = useRouter()
  const { isAuthenticated, user } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
      return
    }
    if (requiredRoles && requiredRoles.length > 0 && user) {
      if (!requiredRoles.includes(user.role)) {
        // Send the user to THEIR own dashboard, not a fixed admin path —
        // see getOwnDashboardPath()'s docstring above for why this
        // avoids a redirect loop.
        router.push(getOwnDashboardPath(user.role))
      }
    }
  }, [isAuthenticated, user, requiredRoles, router])

  // While the redirect effect above is doing its work (or before
  // isAuthenticated has been determined on first load), render nothing
  // rather than flashing a page the user isn't actually allowed to see.
  if (!isAuthenticated || !user) return null

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-64 min-w-0">
        <Header title={title} subtitle={subtitle} />
        <main className="flex-1 overflow-y-auto pt-16 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
