/**
 * TicketIQ — Auth State Store
 * =============================
 * Global, persisted authentication state using Zustand. Holds the
 * current user object plus both tokens, and survives page refreshes
 * via Zustand's `persist` middleware (backed by localStorage under the
 * key "ticketiq-auth" — see the `name` option at the bottom).
 *
 * SUBTLE POINT WORTH KNOWING: the access/refresh tokens are stored in
 * TWO places at once — here (inside the Zustand store, persisted as
 * part of "ticketiq-auth"), AND as their own separate raw localStorage
 * keys ("access_token" / "refresh_token", written directly in
 * setAuth/clearAuth below). That duplication exists because
 * lib/api.ts's axios interceptors read the tokens directly from
 * localStorage by key, without importing this Zustand store at all
 * (partly to avoid a circular import between the two files). Keeping
 * both in sync is why setAuth() and clearAuth() always write/clear
 * both the raw keys AND the Zustand state together — if you ever add a
 * new way to change the tokens, it needs to update both places too.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  email: string
  full_name: string
  role: 'employee' | 'ai_intern' | 'it_support_technician' | 'junior_operations' | 'admin' | 'super_admin'
  employee_id?: string
  department_id?: string
  department_name?: string
  agent_departments?: string[]      // e.g. ["hr"] or ["it","finance"]
  agent_role_key?: string           // ai_intern / it_support_technician / junior_operations
  job_title?: string
  office_location?: string
  avatar_url?: string
  permissions?: string[]
}

interface AuthState {
  user: User | null
  access_token: string | null
  refresh_token: string | null
  isAuthenticated: boolean
  setAuth: (user: User, access_token: string, refresh_token: string) => void
  clearAuth: () => void
  updateUser: (updates: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      access_token: null,
      refresh_token: null,
      isAuthenticated: false,

      // Called once on successful login (see login/page.tsx). Writes
      // the tokens to both raw localStorage AND Zustand state — see
      // the module header above for why both are needed.
      setAuth: (user, access_token, refresh_token) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', access_token)
          localStorage.setItem('refresh_token', refresh_token)
        }
        set({ user, access_token, refresh_token, isAuthenticated: true })
      },

      // Called on logout, or automatically by the axios interceptor
      // (see lib/api.ts) when a refresh token turns out to be invalid
      // and the session can't be recovered.
      clearAuth: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
        }
        set({ user: null, access_token: null, refresh_token: null, isAuthenticated: false })
      },

      // Patches specific fields on the current user object (e.g. after
      // an admin edits their own job_title) without needing a full
      // re-login — merges `updates` into the existing user rather than
      // replacing it entirely.
      updateUser: (updates) =>
        set((state) => ({ user: state.user ? { ...state.user, ...updates } : null })),
    }),
    {
      name: 'ticketiq-auth',  // the localStorage key Zustand's persist middleware stores this under
      // Only these four fields get persisted to localStorage — if any
      // other transient state is ever added to this store later, it
      // won't survive a page refresh unless explicitly added here too.
      partialize: (state) => ({
        user: state.user,
        access_token: state.access_token,
        refresh_token: state.refresh_token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
