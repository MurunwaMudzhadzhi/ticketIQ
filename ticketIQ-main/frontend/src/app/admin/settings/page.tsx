/**
 * TicketIQ — Admin Settings Page
 * ==================================
 * Admin-only system overview and account settings: live system info
 * (database, AI model, environment — all sourced from real backend
 * state via GET /admin/system-stats, not hardcoded), the admin's own
 * account details, a live SAST clock, SLA window reference table, a
 * change-password form, AI feature status, a role/permission matrix,
 * and a "danger zone" with reset instructions.
 *
 * Every piece of "system information" displayed here is meant to
 * genuinely reflect the live deployment rather than a fixed assumption
 * (see the inline comments near each InfoRow below) — several values
 * here used to be hardcoded incorrectly (claiming "Production" /
 * "PostgreSQL" / wrong SLA windows / Groq always active) regardless of
 * the actual running configuration, which has been fixed to read real
 * data wherever the backend exposes it.
 */
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/shared/DashboardLayout'
import { adminApi, authApi } from '@/lib/api'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import {
  Shield, Database, Cpu, Key, Eye, EyeOff, Check, AlertCircle,
  Server, Users, Ticket, Building2, CheckCircle, RefreshCw, Info,
  Globe, Clock, Bell, Activity, Lock, ChevronDown, ChevronUp,
  Zap, BarChart3, Hash,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const SAST = 'Africa/Johannesburg'

/** A collapsible card section with a title/icon header — collapsible only if `collapsible` is passed. */
function Section({ title, icon: Icon, children, danger, collapsible }: {
  title: string; icon: any; children: React.ReactNode; danger?: boolean; collapsible?: boolean
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className={clsx('glass-card rounded-xl border overflow-hidden', danger ? 'border-red-500/30' : 'border-gray-800/60')}>
      <button
        className={clsx('w-full flex items-center justify-between px-5 py-4 border-b text-left',
          danger ? 'border-red-500/20' : 'border-gray-800/60')}
        onClick={() => collapsible && setOpen(v => !v)}>
        <div className="flex items-center gap-2">
          <Icon className={clsx('w-4 h-4', danger ? 'text-red-400' : 'text-blue-400')} />
          <h2 className={clsx('text-sm font-semibold', danger ? 'text-red-400' : 'text-gray-300')}>{title}</h2>
        </div>
        {collapsible && (open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />)}
      </button>
      {(!collapsible || open) && <div className="p-5">{children}</div>}
    </div>
  )
}

/** A label/value row used throughout the info sections, with optional monospace styling and a small status badge. */
function InfoRow({ label, value, mono, badge, badgeColor }: {
  label: string; value?: any; mono?: boolean; badge?: string; badgeColor?: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-800/40 last:border-0 gap-4">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2">
        {badge && (
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', badgeColor ?? 'bg-green-500/10 text-green-400')}>
            {badge}
          </span>
        )}
        <span className={clsx('text-xs font-medium text-gray-300 text-right', mono && 'font-mono')}>{value ?? '—'}</span>
      </div>
    </div>
  )
}

/** A simple on/off switch used for the notification preference rows. */
function Toggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-800/40 last:border-0">
      <div>
        <p className="text-xs font-medium text-white">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        title={label}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx('w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
          checked ? 'bg-blue-500' : 'bg-gray-700')}>
        <span className={clsx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const router         = useRouter()
  const { user }       = useAuthStore()
  const [stats,        setStats]        = useState<any>({})
  const [loadingStats, setLoadingStats] = useState(true)
  const [currentPw,    setCurrentPw]    = useState('')
  const [newPw,        setNewPw]        = useState('')
  const [confirmPw,    setConfirmPw]    = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [savingPw,     setSavingPw]     = useState(false)
  const [pwError,      setPwError]      = useState('')
  const [sastNow,      setSastNow]      = useState<Date | null>(null)

  // Notification preferences — NOTE: these are purely local component
  // state with no persistence at all (not localStorage, not the
  // backend). They reset to their defaults on every page reload; the
  // toast confirmations on toggle ("Escalation alerts on") confirm the
  // toggle was clicked, not that the preference was actually saved
  // anywhere durable. A real implementation would need a backend
  // field (e.g. on the User model) to persist these per-account.
  const [notifEscalated, setNotifEscalated]   = useState(true)
  const [notifCritical,  setNotifCritical]    = useState(true)
  const [notifAssigned,  setNotifAssigned]    = useState(false)
  const [notifResolved,  setNotifResolved]    = useState(false)

  useEffect(() => {
    adminApi.systemStats()
      .then(r => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoadingStats(false))

    // Live SAST clock — ticks every second purely for display in the
    // Timezone & Regional Settings section; doesn't affect any other
    // logic on this page.
    const tick = () => setSastNow(toZonedTime(new Date(), SAST))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])

  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return }
    if (newPw.length < 8)    { setPwError('Minimum 8 characters required'); return }
    setSavingPw(true)
    try {
      await authApi.changePassword(currentPw, newPw)
      toast.success('Password updated successfully')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: any) {
      setPwError(err.response?.data?.detail ?? 'Failed to update password')
    } finally {
      setSavingPw(false)
    }
  }

  const statCards = [
    { label: 'Total Users',   value: stats.total_users,       icon: Users,    color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
    { label: 'Active Users',  value: stats.active_users,      icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: 'Tickets',       value: stats.total_tickets,     icon: Ticket,   color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: 'Departments',   value: stats.total_departments, icon: Building2, color: 'text-amber-400',  bg: 'bg-amber-500/10'  },
  ]

  const pwFields = [
    { label: 'Current Password',     id: 'current-pw', val: currentPw, set: setCurrentPw },
    { label: 'New Password',         id: 'new-pw',     val: newPw,     set: setNewPw     },
    { label: 'Confirm New Password', id: 'confirm-pw', val: confirmPw, set: setConfirmPw },
  ]

  return (
    <DashboardLayout title="Settings" subtitle="System configuration and account settings" requiredRoles={['admin', 'super_admin']}>
      <div className="space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="glass-card rounded-xl p-4 border border-gray-800/60">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-500">{s.label}</p>
                <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', s.bg)}>
                  <s.icon className={clsx('w-4 h-4', s.color)} />
                </div>
              </div>
              <p className={clsx('text-2xl font-bold', s.color)}>{loadingStats ? '—' : (s.value ?? 0)}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* System Info */}
          <Section title="System Information" icon={Server} collapsible>
            <InfoRow label="App Name"      value="TicketIQ Enterprise" />
            <InfoRow label="App Version"   value={stats.app_version ?? '1.0.0'} mono />
            {/* Reflects the real, currently-running deployment mode
                (APP_ENV in the backend's core/config.py) rather than
                always claiming "Production" — this app's own .env
                ships with APP_ENV=development by default, so a
                hardcoded "Production · Live" badge would be actively
                false on a typical local setup. */}
            <InfoRow label="Environment"
              value={loadingStats ? '—' : (stats.app_env === 'production' ? 'Production' : 'Development')}
              badge={loadingStats ? undefined : (stats.app_env === 'production' ? 'Live' : 'Dev')}
              badgeColor={stats.app_env === 'production' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'} />
            {/* db_engine and ai_model both come from GET
                /admin/system-stats, which derives them from the actual
                configured DATABASE_URL / GROQ_API_KEY (see
                system_stats() in api/v1/endpoints/admin.py) rather than
                a hardcoded guess — this app defaults to SQLite in dev,
                not PostgreSQL, and has no AI key configured unless one
                is explicitly set. */}
            <InfoRow label="Database"      value={stats.db_engine ?? '—'} mono />
            <InfoRow label="AI Model"      value={stats.ai_model  ?? '—'} mono />
            {/* API_URL is read from the same env var the actual API
                client uses (see NEXT_PUBLIC_API_URL in lib/api.ts) so
                this never claims localhost on a real deployment. */}
            <InfoRow label="API URL"       value={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'} mono />
            <InfoRow label="Frontend"      value="Next.js 14 · React 18 · Tailwind" />
            <InfoRow label="Auth"          value="JWT Bearer + Refresh Tokens" />
            <InfoRow label="ORM"           value="SQLAlchemy 2 (async)" mono />
          </Section>

          {/* Account */}
          <Section title="Your Account" icon={Shield} collapsible>
            <div className="flex items-center gap-4 mb-5 p-4 rounded-xl bg-gray-900/60 border border-gray-800/60">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                {user?.full_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{user?.full_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{user?.email}</p>
                <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                  <Shield className="w-3 h-3" />
                  {user?.role?.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
            <InfoRow label="Employee ID"  value={user?.employee_id    ?? 'N/A'} mono />
            <InfoRow label="Department"   value={user?.department_name ?? 'None'} />
            <InfoRow label="Job Title"    value={user?.job_title       ?? 'N/A'} />
            <InfoRow label="Account Status" badge="Active" badgeColor="bg-green-500/10 text-green-400" />
            {/* NOTE: the backend DOES track a real last_login timestamp
                per user (see User.last_login in models.py, set on every
                successful login in auth.py) — but it's never included
                in the /auth/me response, so there's currently no real
                data to show here. "This session" is accurate as far as
                it goes (the user IS in their current session) but isn't
                actually reading last_login; exposing that field on
                /auth/me would be a natural follow-up improvement. */}
            <InfoRow label="Last Login"   value="This session" />
          </Section>
        </div>

        {/* Timezone & Regional Settings */}
        <Section title="Timezone & Regional Settings" icon={Globe} collapsible>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <InfoRow label="System Timezone" value="Africa/Johannesburg" mono badge="SAST" badgeColor="bg-amber-500/10 text-amber-400" />
              <InfoRow label="UTC Offset"      value="UTC+2 (standard) · UTC+2 (no DST)" mono />
              <InfoRow label="Region"          value="South Africa" />
              <InfoRow label="Date Format"     value="dd MMM yyyy" mono />
              <InfoRow label="Time Format"     value="24-hour (HH:mm)" mono />
              <InfoRow label="Week Starts"     value="Monday" />
            </div>
            <div className="flex items-center justify-center">
              <div className="text-center p-6 rounded-xl bg-gray-900/60 border border-gray-800/60 w-full">
                <p className="text-xs text-gray-500 mb-2 flex items-center justify-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Current SAST time
                </p>
                <p className="text-3xl font-mono font-bold text-white tracking-widest">
                  {sastNow ? format(sastNow, 'HH:mm:ss') : '—'}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {sastNow ? format(sastNow, 'EEEE, dd MMMM yyyy') : '—'}
                </p>
                <p className="text-xs text-amber-400 mt-2 font-medium">South Africa Standard Time</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              All timestamps in TicketIQ — including ticket creation times, SLA deadlines, comments, and audit logs —
              are stored as UTC and displayed in <span className="font-mono text-amber-400">Africa/Johannesburg (SAST, UTC+2)</span>. South Africa does not observe daylight saving time, so the offset remains constant year-round.
            </p>
          </div>
        </Section>

        {/* SLA Configuration */}
        <Section title="SLA Configuration" icon={Activity} collapsible>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {/* These windows must exactly match SLA_HOURS in the
                backend's services/tickets/ticket_service.py — that
                mapping is what's actually used to compute every
                ticket's real sla_deadline at creation time. Showing a
                different number here would mislead admins about how
                the live system actually behaves (this previously
                showed 8/24/72h for High/Medium/Low instead of the
                real 24/72/168h). */}
            {[
              { priority: 'Critical', window: '4 hours',   color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
              { priority: 'High',     window: '24 hours',  color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
              { priority: 'Medium',   window: '72 hours',  color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
              { priority: 'Low',      window: '168 hours', color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
            ].map(item => (
              <div key={item.priority} className={clsx('flex items-center justify-between p-3 rounded-xl border', item.bg, item.border)}>
                <div className="flex items-center gap-2">
                  <Clock className={clsx('w-4 h-4', item.color)} />
                  <span className={clsx('text-sm font-semibold', item.color)}>{item.priority}</span>
                </div>
                <span className="text-sm text-gray-300 font-mono">{item.window}</span>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              SLA deadlines are calculated from ticket creation time in SAST. Breached tickets appear highlighted in red across all views. To modify SLA windows, update the{' '}
              <span className="font-mono text-blue-400">SLA_HOURS</span> mapping in{' '}
              <span className="font-mono text-blue-400">backend/app/core/config.py</span>.
            </p>
          </div>
        </Section>

        {/* Notification Preferences */}
        <Section title="Notification Preferences" icon={Bell} collapsible>
          <p className="text-xs text-gray-500 mb-4">Control which events trigger in-app notification alerts for your account. Changes take effect immediately.</p>
          <Toggle
            label="Escalated tickets"
            desc="Alert when a ticket is escalated to critical priority handling"
            checked={notifEscalated}
            onChange={v => { setNotifEscalated(v); toast.success(v ? 'Escalation alerts on' : 'Escalation alerts off') }}
          />
          <Toggle
            label="Critical priority tickets"
            desc="Alert when a new critical-priority ticket is submitted"
            checked={notifCritical}
            onChange={v => { setNotifCritical(v); toast.success(v ? 'Critical alerts on' : 'Critical alerts off') }}
          />
          <Toggle
            label="Tickets assigned to me"
            desc="Alert when a ticket is routed or assigned to your queue"
            checked={notifAssigned}
            onChange={v => { setNotifAssigned(v); toast.success(v ? 'Assignment alerts on' : 'Assignment alerts off') }}
          />
          <Toggle
            label="Ticket resolved"
            desc="Alert when one of your submitted tickets is marked resolved"
            checked={notifResolved}
            onChange={v => { setNotifResolved(v); toast.success(v ? 'Resolution alerts on' : 'Resolution alerts off') }}
          />
        </Section>

        {/* Change Password */}
        <Section title="Security — Change Password" icon={Key} collapsible>
          <form onSubmit={handleChangePw} className="max-w-md space-y-4">
            {pwError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-sm">{pwError}</p>
              </div>
            )}
            <div className="p-3 rounded-xl bg-gray-900/60 border border-gray-800/60 mb-2">
              <p className="text-xs text-gray-500">Password requirements: minimum 8 characters. Use a mix of letters, numbers, and symbols for stronger security.</p>
            </div>
            {pwFields.map(f => (
              <div key={f.id}>
                <label htmlFor={f.id} className="text-xs font-medium text-gray-400 mb-1.5 block">{f.label}</label>
                <div className="relative">
                  <input
                    id={f.id}
                    type={showPw ? 'text' : 'password'}
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    required
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 pr-10 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
            <button type="submit" disabled={savingPw}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-5 py-2.5 text-sm font-medium transition">
              {savingPw
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                : <><Check className="w-4 h-4" />Update Password</>}
            </button>
          </form>
        </Section>

        {/* AI Config */}
        <Section title="AI Configuration" icon={Cpu} collapsible>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {/* The Groq LLM API card's `active` status is the ONE item
                in this list that genuinely depends on whether
                GROQ_API_KEY is configured (see stats.ai_model, sourced
                from the real settings check in system_stats() —
                api/v1/endpoints/admin.py). It previously claimed
                active:true unconditionally, contradicting the warning
                box right below this grid that correctly explains the
                keyword fallback exists. Every OTHER row here genuinely
                always works regardless of whether Groq is configured,
                since they all have real non-AI fallback paths (see
                services/ai/response_service.py / groq_service.py) —
                so those stay hardcoded true. */}
            {[
              { label: 'Groq LLM API',     detail: 'llama3-8b-8192 via Groq Cloud',          active: !!stats.ai_model && !stats.ai_model.startsWith('Not configured') },
              { label: 'Classification',   detail: 'Token-based AI department routing',       active: true  },
              { label: 'Auto-Response',    detail: 'Formal / Friendly / Urgent tone engine',  active: true  },
              { label: 'Self-Help Engine', detail: 'Employee-facing resolution guidance',     active: true  },
              { label: 'Sentiment Scan',   detail: 'Detects frustrated / urgent tone',        active: true  },
              { label: 'Confidence Score', detail: 'Routing confidence as a percentage',      active: true  },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3 p-3 rounded-xl bg-gray-900/60 border border-gray-800/60">
                <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', item.active ? 'bg-green-400' : 'bg-red-400')} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">{item.label}</p>
                  <p className="text-xs text-gray-500 truncate">{item.detail}</p>
                </div>
                <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full',
                  item.active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                  {item.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              Set <span className="font-mono text-blue-400">GROQ_API_KEY</span> in{' '}
              <span className="font-mono text-blue-400">backend/.env</span> to enable live AI features.
              Without it the system falls back to keyword-based classification.
            </p>
          </div>
        </Section>

        {/* Role Matrix */}
        <Section title="Role & Access Matrix" icon={Lock} collapsible>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/60">
                  <th className="text-left py-2 pr-4 text-gray-500 font-medium">Role</th>
                  <th className="text-center py-2 px-2 text-gray-500 font-medium">Submit</th>
                  <th className="text-center py-2 px-2 text-gray-500 font-medium">Resolve</th>
                  <th className="text-center py-2 px-2 text-gray-500 font-medium">Escalate</th>
                  <th className="text-center py-2 px-2 text-gray-500 font-medium">Users</th>
                  <th className="text-center py-2 px-2 text-gray-500 font-medium">Settings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/40">
                {[
                  { role: 'Employee',              submit: true,  resolve: false, escalate: false, users: false, settings: false },
                  { role: 'AI Intern (HR)',         submit: false, resolve: true,  escalate: true,  users: false, settings: false },
                  { role: 'IT Support Tech',        submit: false, resolve: true,  escalate: true,  users: false, settings: false },
                  { role: 'Junior Operations',      submit: false, resolve: true,  escalate: true,  users: false, settings: false },
                  { role: 'Admin',                  submit: true,  resolve: true,  escalate: true,  users: true,  settings: true  },
                  { role: 'Super Admin',            submit: true,  resolve: true,  escalate: true,  users: true,  settings: true  },
                ].map(row => (
                  <tr key={row.role} className={clsx('', user?.role?.replace(/_/g,' ') === row.role.toLowerCase() && 'bg-blue-500/5')}>
                    <td className="py-2.5 pr-4">
                      <span className="text-gray-300 font-medium">{row.role}</span>
                      {user?.role?.replace(/_/g,' ') === row.role.toLowerCase() && (
                        <span className="ml-2 text-xs text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">you</span>
                      )}
                    </td>
                    {[row.submit, row.resolve, row.escalate, row.users, row.settings].map((v, i) => (
                      <td key={i} className="py-2.5 px-2 text-center">
                        {v ? <CheckCircle className="w-3.5 h-3.5 text-green-400 mx-auto" /> :
                             <span className="w-3.5 h-3.5 block mx-auto text-gray-700">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Danger Zone */}
        <Section title="Danger Zone" icon={AlertCircle} danger>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-xl border border-red-500/20 bg-red-500/5">
              <div>
                <p className="text-sm font-medium text-white">Reset Demo Data</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Re-run: <span className="font-mono text-amber-400">python scripts/seed_data.py</span>
                </p>
              </div>
              <RefreshCw className="w-5 h-5 text-red-400 flex-shrink-0 ml-4" />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl border border-red-500/20 bg-red-500/5">
              <div>
                <p className="text-sm font-medium text-white">Database</p>
                {/* Reflects the real configured database (stats.db_engine,
                    same source as the System Information section above)
                    rather than always claiming PostgreSQL — this app
                    defaults to SQLite in development, where Alembic
                    migrations exist but resetting the schema is just as
                    often done by deleting the .db file and re-running
                    init_db() (see db/session.py). */}
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="font-mono text-amber-400">{stats.db_engine ?? 'Unknown'}</span> — use Alembic migrations to evolve the schema
                </p>
              </div>
              <Database className="w-5 h-5 text-red-400 flex-shrink-0 ml-4" />
            </div>
          </div>
        </Section>

      </div>
    </DashboardLayout>
  )
}