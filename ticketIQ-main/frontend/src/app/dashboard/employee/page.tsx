/**
 * TicketIQ — Employee Dashboard
 * ================================
 * Landing page for regular employee accounts: personal ticket KPIs, an
 * explainer banner about the AI auto-response feature, a quick "submit
 * a ticket" action, and a list of the employee's 5 most recent tickets.
 *
 * ticketsApi.list() here returns only tickets THIS employee submitted
 * (see get_tickets_for_user() in the backend's ticket_service.py) — no
 * client-side filtering by submitter is needed.
 */
'use client'
import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/shared/DashboardLayout'
import KPICard from '@/components/ui/KPICard'
import { ticketsApi, analyticsApi } from '@/lib/api'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Ticket, Clock, CheckCircle, AlertTriangle, Plus, ChevronRight, Sparkles, Cpu } from 'lucide-react'
import { PriorityBadge, StatusBadge } from '@/components/ui/TicketBadge'
import { formatDistanceToNow } from 'date-fns'
import { useAuthStore } from '@/stores/authStore'

// Same hex-to-Tailwind-text-colour pattern as DOT_BG_CLASSES in
// components/ui/TicketBadge.tsx, but for text colour instead of
// background — used to colour a ticket's department name inline next
// to its ticket number. Same caveat applies: any department colour not
// in this exact list falls back to plain grey text.
const DEPARTMENT_COLOR_CLASSES: Record<string, string> = {
  '#8B5CF6': 'text-[#8B5CF6]',
  '#3B82F6': 'text-[#3B82F6]',
  '#10B981': 'text-[#10B981]',
  '#F59E0B': 'text-[#F59E0B]',
}

export default function EmployeeDashboard() {
  const { user } = useAuthStore()
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ticketsApi.list().then(({ data }) => {
      setTickets(data.tickets || [])
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const open       = tickets.filter(t => t.status === 'open' || t.status === 'pending').length
  const inProgress = tickets.filter(t => t.status === 'in_progress' || t.status === 'assigned').length
  const resolved   = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length
  const escalated  = tickets.filter(t => t.is_escalated).length

  const recent = tickets.slice(0, 5)

  return (
    <DashboardLayout title="My Dashboard" subtitle={`Welcome back, ${user?.full_name?.split(' ')[0]}`}>
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Open Tickets"    value={open}       icon={Ticket}       color="blue"   index={0} />
          <KPICard title="In Progress"     value={inProgress} icon={Clock}        color="purple" index={1} />
          <KPICard title="Resolved"        value={resolved}   icon={CheckCircle}  color="green"  index={2} />
          <KPICard title="Escalated"       value={escalated}  icon={AlertTriangle} color="red"   index={3} />
        </div>

        {/* AI auto-response info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="glass-card rounded-xl p-4 border border-blue-500/20 flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">AI-Powered Support Active</p>
            <p className="text-xs text-gray-500 mt-0.5">
              When you submit a ticket, our AI instantly reads it, routes it to the right agent,
              and sends you an automated first response. Open any ticket to see the thread.
            </p>
          </div>
        </motion.div>

        {/* Quick actions */}
        <div className="glass-card rounded-xl p-5 border border-gray-800/60">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Quick Actions</h2>
          <Link href="/tickets/new"
            className="flex items-center gap-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-3 font-medium text-sm transition w-fit">
            <Plus className="w-4 h-4" />
            Submit a New Ticket
          </Link>
        </div>

        {/* Recent tickets */}
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60">
            <h2 className="text-sm font-semibold text-gray-300">Recent Tickets</h2>
            <Link href="/tickets" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">Loading...</div>
          ) : recent.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500 text-sm">No tickets yet.</p>
              <Link href="/tickets/new" className="text-blue-400 text-sm mt-1 inline-block">Submit your first ticket →</Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-800/40">
              {recent.map((t, i) => (
                <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                  <Link href={`/tickets/${t.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-900/40 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      {t.is_escalated && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{t.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {t.ticket_number}
                          {t.department && (
                            <> · <span className={DEPARTMENT_COLOR_CLASSES[t.department.color] || 'text-gray-300'}>{t.department.name}</span></>
                          )}
                          {t.ai?.category && <> · {t.ai.category}</>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                      {/* Uses the backend's has_ai_reply flag rather
                          than checking t.comments directly — the
                          ticket LIST endpoint never includes full
                          comment bodies (only the single-ticket detail
                          endpoint does), so t.comments is always
                          undefined here and a comments-based check
                          would always evaluate to false. See
                          _ticket_to_dict() in
                          api/v1/endpoints/tickets.py for where this
                          field comes from. */}
                      {t.has_ai_reply && (
                        <span className="hidden sm:flex items-center gap-1 text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">
                          <Sparkles className="w-3 h-3" /> AI replied
                        </span>
                      )}
                      <span className="text-xs text-gray-600 hidden sm:block">
                        {t.created_at ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true }) : ''}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
