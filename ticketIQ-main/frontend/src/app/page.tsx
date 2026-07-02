/**
 * TicketIQ — Root Route ("/")
 * =============================
 * This page renders nothing visible itself — it's a pure traffic
 * router. The moment it loads, it checks whether the visitor is
 * logged in and sends them straight to the right dashboard for their
 * role (or to /login if they're not authenticated at all). The
 * spinner below is only ever seen for the brief instant before that
 * redirect fires.
 *
 * This mirrors the same role -> dashboard mapping as get_redirect_url()
 * in the backend (services/auth/auth_service.py) — if a new role or
 * dashboard is ever added, both places need updating together.
 */
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'

export default function RootPage() {
  const router = useRouter()
  const { isAuthenticated, user } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated || !user) {
      router.replace('/login')
      return
    }

    const role = user.role
    if (role === 'admin' || role === 'super_admin') {
      router.replace('/dashboard/admin')
    } else if (role === 'ai_intern' || role === 'it_support_technician' || role === 'junior_operations') {
      router.replace('/dashboard/agent')
    } else {
      router.replace('/dashboard/employee')
    }
  }, [isAuthenticated, user, router])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
}
