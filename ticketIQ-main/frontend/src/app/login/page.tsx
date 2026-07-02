/**
 * TicketIQ — Login Page
 * =======================
 * The public sign-in screen: a real login form on the left, plus a
 * panel of one-click "quick login" demo account cards on the right so
 * anyone evaluating the app can sign in as any role without needing to
 * remember or type credentials. Clicking any demo card just fills the
 * email/password fields via quickFill() below — it does NOT log in
 * automatically, so the person can see which account they're about to
 * use before submitting.
 *
 * The accounts listed here must stay in sync with whatever the seed
 * scripts actually create (see scripts/seed_data.py) — if the seed
 * data ever changes, these cards need updating to match, or "quick
 * login" will fill in credentials that no longer exist.
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Zap, Mail, Lock, Eye, EyeOff, AlertCircle, Cpu, Users, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'

// Quick-login demo accounts shown on the right side of the sign-in screen.
// `name` is shown bold as the primary label, `role` is the colored
// subtitle beneath it (matching the department/role badge), and `email`
// is the small monospace line used for the actual login request.
const EMPLOYEES = [
  { name: 'Mutshutshudzi Nemanashi', role: 'HR Employee',         email: 'mutshutshudzi.nemanashi@ticketiq.com', pw: 'TicketIQ@2026', color: 'border-purple-500/30', badge: 'text-purple-400' },
  { name: 'Lehlogonolo Ledwaba',     role: 'IT Employee',         email: 'lehlogonolo.ledwaba@ticketiq.com',     pw: 'TicketIQ@2026', color: 'border-blue-500/30',   badge: 'text-blue-400' },
  { name: 'Pamela Sibiya',           role: 'Finance Employee',    email: 'pamela.sibiya@ticketiq.com',           pw: 'TicketIQ@2026', color: 'border-green-500/30',  badge: 'text-green-400' },
  { name: 'Murunwa Mudzhadzhi',      role: 'Operations Employee', email: 'murunwa.mudzhadzhi.emp@ticketiq.com',  pw: 'TicketIQ@2026', color: 'border-amber-500/30',  badge: 'text-amber-400' },
]

const AGENTS = [
  { name: 'Lerato Selowa',      role: 'AI Intern',               handles: 'HR tickets',           email: 'lerato.selowa@ticketiq.com',             pw: 'TicketIQ@2026', color: 'border-purple-500/30', badge: 'text-purple-400' },
  { name: 'Leslie Kekana',      role: 'IT Support Assistant',        handles: 'IT + Finance tickets',  email: 'leslie.kekana@ticketiq.com',             pw: 'TicketIQ@2026', color: 'border-blue-500/30',   badge: 'text-blue-400' },
  { name: 'Murunwa Mudzhadzhi', role: 'Junior Automation Support', handles: 'Operations tickets',    email: 'murunwa.mudzhadzhi.agent@ticketiq.com',  pw: 'TicketIQ@2026', color: 'border-amber-500/30',  badge: 'text-amber-400' },
]

export default function LoginPage() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setError('')
    setLoading(true)
    try {
      const { data } = await authApi.login(email, password)
      setAuth(data.user, data.access_token, data.refresh_token)
      toast.success(`Welcome back, ${data.user.full_name}!`)
      // The backend tells us exactly which dashboard to go to based on
      // the user's role (see get_redirect_url() in auth_service.py) —
      // the frontend doesn't need its own copy of that role->path mapping here.
      router.push(data.redirect_url)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Fills the email/password fields from a clicked demo account card —
  // doesn't submit the form automatically, so the person can confirm
  // which account they're choosing before hitting "Sign in".
  const quickFill = (em: string, pw: string) => { setEmail(em); setPassword(pw); setError('') }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        {/* Login form */}
        <div className="glass-card rounded-2xl p-8 border border-gray-800/60 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">TicketIQ</h1>
              <p className="text-xs text-gray-500">Enterprise Support Platform</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">Sign in</h2>
          <p className="text-gray-500 text-sm mb-6">Access your support dashboard</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 mb-4">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com" required
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-10 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-sm transition flex items-center justify-center gap-2">
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in...</>
                : 'Sign in →'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-gray-800/60">
            <p className="text-xs text-gray-600 mb-1">Admin access</p>
            <button onClick={() => quickFill('admin@ticketiq.com', 'Admin@1234')}
              className="text-xs text-blue-400 hover:text-blue-300 font-mono transition">
              admin@ticketiq.com · Admin@1234
            </button>
          </div>
        </div>

        {/* Demo accounts */}
        <div className="space-y-4">
          {/* Employees */}
          <div className="glass-card rounded-2xl p-5 border border-gray-800/60">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-gray-400" />
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Department Employees</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">Each employee only sees and submits their own tickets. AI automatically routes to the right agent.</p>
            <div className="grid grid-cols-2 gap-2">
              {EMPLOYEES.map(acc => (
                <button key={acc.email} onClick={() => quickFill(acc.email, acc.pw)}
                  className={`text-left p-3 rounded-lg border ${acc.color} bg-gray-900/50 hover:bg-gray-800/60 transition group`}>
                  <p className="text-xs font-semibold text-white group-hover:text-blue-300 transition leading-tight">{acc.name}</p>
                  <p className={`text-xs mt-0.5 ${acc.badge}`}>{acc.role}</p>
                  <p className="text-xs text-gray-600 mt-1 truncate font-mono">{acc.email}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-2">Password: <span className="text-gray-400 font-mono">TicketIQ@2026</span></p>
          </div>

          {/* Agents */}
          <div className="glass-card rounded-2xl p-5 border border-gray-800/60">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-gray-400" />
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Support Agents</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">AI reads each ticket and decides which agent role is best equipped to solve it.</p>
            <div className="grid grid-cols-3 gap-2">
              {AGENTS.map(acc => (
                <button key={acc.email} onClick={() => quickFill(acc.email, acc.pw)}
                  className={`text-left p-3 rounded-lg border ${acc.color} bg-gray-900/50 hover:bg-gray-800/60 transition group`}>
                  <div className="flex items-center gap-1 mb-1">
                    <Wrench className="w-3 h-3 text-gray-500 flex-shrink-0" />
                    <p className="text-xs font-semibold text-white group-hover:text-blue-300 transition truncate">{acc.name}</p>
                  </div>
                  <p className={`text-xs ${acc.badge} leading-tight`}>{acc.role}</p>
                  <p className="text-xs text-gray-600 mt-1 leading-tight">{acc.handles}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-2">Password: <span className="text-gray-400 font-mono">TicketIQ@2026</span></p>
          </div>
        </div>

      </motion.div>
    </div>
  )
}
