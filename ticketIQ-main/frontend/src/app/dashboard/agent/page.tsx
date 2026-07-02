/**
 * TicketIQ — Agent Dashboard
 * =============================
 * Landing page for the three support agent roles (ai_intern,
 * it_support_technician, junior_operations). Shows the agent's "skill
 * area" (a human-readable description of what kinds of tickets get
 * routed to them), KPIs for their personal queue, an explainer banner
 * about the auto-response feature, and a table of every ticket
 * currently assigned to them.
 *
 * Note: ticketsApi.list() automatically returns only THIS agent's
 * tickets — see get_tickets_for_user() in the backend's
 * ticket_service.py — so no extra filtering is needed here; whatever
 * comes back from the API is already scoped correctly.
 */
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/shared/DashboardLayout'
import KPICard from '@/components/ui/KPICard'
import { ticketsApi } from '@/lib/api'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Ticket, Clock, CheckCircle, AlertTriangle, Cpu, ChevronRight, Sparkles, Zap } from 'lucide-react'
import { PriorityBadge, StatusBadge, DepartmentBadge } from '@/components/ui/TicketBadge'
import { formatDistanceToNow } from 'date-fns'
import { useAuthStore } from '@/stores/authStore'

// Maps each backend role key to a human-friendly display label.
const ROLE_LABELS: Record<string, string> = {
  ai_intern:             'AI Intern',
  it_support_technician: 'IT Support Technician',
  junior_operations:     'Junior Operations Agent',
  admin:                 'Administrator',
  super_admin:           'Super Admin',
}

// A plain-language description of what each agent role's "skill area"
// covers, shown in the identity card at the top of the page. This is
// purely descriptive UI copy — it does NOT reflect a hard department
// restriction, since the actual AI routing matches by skill tokens and
// can route any ticket to any agent (see groq_service.py); this text
// just describes each role's TYPICAL focus area for the agent's own
// context, not an enforced boundary.
const ROLE_SKILLS: Record<string, string> = {
  ai_intern:             'HR & People Operations',
  it_support_technician: 'IT Infrastructure & Financial Systems',
  junior_operations:     'Facilities, Logistics & Procurement',
}

export default function AgentDashboard() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const role      = user?.role || ''
  const roleLabel = ROLE_LABELS[role] || role
  const skillDesc = ROLE_SKILLS[role] || 'All departments'

  useEffect(() => {
    ticketsApi.list().then(({ data }) => {
      setTickets(data.tickets || [])
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const open       = tickets.filter(t => ['open','pending','assigned'].includes(t.status)).length
  const inProgress = tickets.filter(t => t.status === 'in_progress').length
  const resolved   = tickets.filter(t => ['resolved','closed'].includes(t.status)).length
  const escalated  = tickets.filter(t => t.is_escalated).length
  // Uses the backend's has_ai_reply flag (see _ticket_to_dict() in
  // api/v1/endpoints/tickets.py) rather than checking t.comments
  // directly — the ticket LIST endpoint never included full comment
  // bodies (only the single-ticket detail endpoint does), so a
  // comments-based check here would always silently evaluate to zero.
  const aiResponded = tickets.filter(t => t.has_ai_reply).length

  return (
    <DashboardLayout title="Agent Dashboard" subtitle={roleLabel}>
      <div className="space-y-6">

        {/* Agent identity card */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-4 border border-blue-500/20 flex items-center gap-4"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Cpu className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">{roleLabel}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Skill area: <span className="text-blue-400">{skillDesc}</span>
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              AI tokenization routes tickets to you based on content — not department rules
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-bold text-blue-400">{tickets.length}</p>
            <p className="text-xs text-gray-500">in your queue</p>
          </div>
        </motion.div>

        {/* KPIs — includes AI auto-response stat */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard title="Open"        value={open}        icon={Ticket}        color="blue"   index={0} />
          <KPICard title="In Progress" value={inProgress}  icon={Clock}         color="purple" index={1} />
          <KPICard title="Resolved"    value={resolved}    icon={CheckCircle}   color="green"  index={2} />
          <KPICard title="Escalated"   value={escalated}   icon={AlertTriangle} color="red"    index={3} />
          <KPICard title="AI Replied"  value={aiResponded} icon={Sparkles}      color="blue"   index={4} />
        </div>

        {/* Auto-response info banner */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="glass-card rounded-xl p-4 border border-purple-500/20 flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Automated Response Generation is active</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Every new ticket gets an instant AI first-response. Open any ticket to use the
              <span className="text-purple-400 mx-1">AI Response Generator</span>
              — generate replies in <span className="text-blue-400">Formal</span>,{' '}
              <span className="text-green-400">Friendly</span>, or{' '}
              <span className="text-red-400">Urgent</span> tone and insert them with one click.
            </p>
          </div>
        </motion.div>

        {/* Ticket queue */}
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-gray-300">Your Queue</h2>
              <span className="text-xs text-gray-600">— AI-routed to you by token match</span>
            </div>
            <Link href="/tickets" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">Loading queue...</div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No tickets in your queue 🎉</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/60 bg-gray-900/40">
                    {['#', 'Title / AI Category', 'Department', 'Priority', 'Status', 'AI Response', 'Submitted'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {tickets.slice(0, 20).map((t, i) => {
                    // Same has_ai_reply field as the KPI count above —
                    // see the comment near aiResponded for why this
                    // can't be derived from t.comments on this page.
                    const hasAiReply = t.has_ai_reply
                    return (
                      <motion.tr
                        key={t.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className="hover:bg-gray-900/40 transition cursor-pointer"
                        onClick={() => router.push(`/tickets/${t.id}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {t.is_escalated && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                            <span className="font-mono text-xs text-gray-500">{t.ticket_number}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white font-medium truncate max-w-xs">{t.title}</p>
                          {t.ai?.category && (
                            <p className="text-xs text-blue-400/70 mt-0.5 flex items-center gap-1">
                              <Cpu className="w-3 h-3" /> {t.ai.category}
                            </p>
                          )}
                          {t.ai?.routing_rationale && (
                            <p className="text-xs text-gray-600 mt-0.5 truncate max-w-xs">{t.ai.routing_rationale}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {t.department
                            ? <DepartmentBadge name={t.department.name} color={t.department.color} />
                            : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                        <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                        <td className="px-4 py-3">
                          {hasAiReply
                            ? <span className="flex items-center gap-1 text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">
                                <Sparkles className="w-3 h-3" /> Sent
                              </span>
                            : <span className="text-xs text-gray-600">Pending</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {t.created_at ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true }) : '—'}
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  )
}
