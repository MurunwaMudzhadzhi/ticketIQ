/**
 * TicketIQ — Admin Dashboard
 * =============================
 * The landing page for admin/super_admin accounts: top-line KPIs, two
 * charts (tickets by department, tickets by priority), a static "AI
 * Routing Table" reference card, and a table of the 10 most recent
 * tickets across the whole system.
 *
 * Note: this is intentionally a lighter-weight overview than the full
 * /analytics/admin page — that page has the deeper breakdowns (SLA
 * tracking, agent performance, weekly insights report). This page is
 * meant to be the first thing an admin sees, not the full analytics suite.
 */
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/shared/DashboardLayout'
import KPICard from '@/components/ui/KPICard'
import { analyticsApi, ticketsApi } from '@/lib/api'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  Ticket, Clock, CheckCircle, AlertTriangle, Users, Building2,
  TrendingUp, ChevronRight, Cpu, Shield
} from 'lucide-react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { PriorityBadge, StatusBadge, DepartmentBadge } from '@/components/ui/TicketBadge'
import { formatDistanceToNow } from 'date-fns'

// Department -> accent colour, used to colour the "tickets by
// department" bar chart bars. Kept in sync with Department.color in
// the backend (models.py) and core/config.py's DEPARTMENTS list.
const DEPT_COLORS: Record<string, string> = {
  'Human Resources':       '#8B5CF6',
  'Information Technology':'#3B82F6',
  'Finance':               '#10B981',
  'Operations':            '#F59E0B',
}

export default function AdminDashboard() {
  const router = useRouter()
  const [overview, setOverview] = useState<any>({})
  const [deptData, setDeptData] = useState<any[]>([])
  const [priorityData, setPriorityData] = useState<any[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Fetches everything this page needs in parallel on mount — overview
  // KPIs, the department breakdown, the priority breakdown, and the
  // full ticket list (only the first 10 of which actually get
  // rendered, in the Recent Tickets table further down).
  useEffect(() => {
    Promise.all([
      analyticsApi.overview(),
      analyticsApi.byDepartment(),
      analyticsApi.byPriority(),
      ticketsApi.list(),
    ]).then(([ov, dept, prio, tix]) => {
      setOverview(ov.data)
      setDeptData(dept.data)
      setPriorityData(prio.data)
      setTickets(tix.data.tickets || [])
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  // Priority -> colour, in two different forms: PRIO_COLORS is a raw
  // hex string for Recharts (which accepts colours as plain style
  // values), while PRIO_CLASSES is a Tailwind class name for the
  // plain-HTML legend dots below the pie chart — Recharts and Tailwind
  // need the colour expressed differently, so both exist side by side
  // rather than deriving one from the other.
  const PRIO_COLORS: Record<string, string> = {
    critical: '#ef4444',
    high:     '#f97316',
    medium:   '#eab308',
    low:      '#22c55e',
  }

  const PRIO_CLASSES: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-green-500',
  }

  // Same hex-to-Tailwind-class pattern as DOT_BG_CLASSES in
  // components/ui/TicketBadge.tsx — see that file's comment for why a
  // lookup table is needed here instead of a dynamic `bg-[${color}]` class.
  const ROUTING_CLASSES: Record<string, string> = {
    '#8B5CF6': 'bg-[#8B5CF6]',
    '#3B82F6': 'bg-[#3B82F6]',
    '#10B981': 'bg-[#10B981]',
    '#F59E0B': 'bg-[#F59E0B]',
  }

  return (
    <DashboardLayout title="Admin Dashboard" subtitle="Full system overview" requiredRoles={['admin', 'super_admin']}>
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPICard title="Total Tickets" value={overview.total ?? '—'}       icon={Ticket}        color="blue"   index={0} />
          <KPICard title="Open"          value={overview.open ?? '—'}        icon={Clock}         color="cyan"   index={1} />
          <KPICard title="In Progress"   value={overview.in_progress ?? '—'} icon={TrendingUp}    color="purple" index={2} />
          <KPICard title="Resolved"      value={overview.resolved ?? '—'}    icon={CheckCircle}   color="green"  index={3} />
          <KPICard title="Escalated"     value={overview.escalated ?? '—'}   icon={AlertTriangle} color="red"    index={4} />
          <KPICard title="Critical"      value={overview.critical ?? '—'}    icon={Shield}        color="red"    index={5} />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* By department */}
          <div className="glass-card rounded-xl p-5 border border-gray-800/60">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              Tickets by Department
            </h2>
            {deptData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={deptData} margin={{ left: -20 }}>
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={n => n.split(' ')[0]} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#f9fafb' }}
                    itemStyle={{ color: '#9ca3af' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {deptData.map((entry, idx) => (
                      <Cell key={idx} fill={DEPT_COLORS[entry.name] || '#3B82F6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
            )}
          </div>

          {/* By priority */}
          <div className="glass-card rounded-xl p-5 border border-gray-800/60">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              Tickets by Priority
            </h2>
            {priorityData.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie data={priorityData} dataKey="count" nameKey="priority"
                      cx="50%" cy="50%" outerRadius={80} innerRadius={50}>
                      {priorityData.map((entry, idx) => (
                        <Cell key={idx} fill={PRIO_COLORS[entry.priority] || '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                      labelStyle={{ color: '#f9fafb' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {priorityData.map(p => (
                    <div key={p.priority} className="flex items-center gap-2">
                      <span className={clsx('w-3 h-3 rounded-full flex-shrink-0', PRIO_CLASSES[p.priority] || 'bg-slate-500')} />
                      <span className="text-xs text-gray-400 capitalize">{p.priority}</span>
                      <span className="text-xs font-bold text-white ml-auto">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
            )}
          </div>
        </div>

        {/* Routing summary — NOTE: this table is hardcoded static
            reference data (which department routes to which agent
            role), not a live query. It's meant as an at-a-glance
            explainer of the routing system, not a reflection of any
            specific ticket's actual routing decision — see each
            ticket's own `ai.routed_to_agent_name` /
            `ai.routing_rationale` fields (rendered in the ticket
            detail page) for the REAL routing decision on a given
            ticket, which can differ from this table since any agent
            can technically be routed any ticket based on skill-token
            matching (see ticket_service.py). If an agent's email or
            assignment ever changes, this table needs updating by hand
            to match. */}
        <div className="glass-card rounded-xl p-5 border border-gray-800/60">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            AI Routing Table
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { dept: 'Human Resources',        color: '#8B5CF6', agent: 'AI Intern',             email: 'lerato.selowa@ticketiq.com' },
              { dept: 'Information Technology', color: '#3B82F6', agent: 'IT Support Technician', email: 'leslie.kekana@ticketiq.com' },
              { dept: 'Finance',                color: '#10B981', agent: 'IT Support Technician', email: 'leslie.kekana@ticketiq.com' },
              { dept: 'Operations',             color: '#F59E0B', agent: 'Junior Operations',      email: 'murunwa.mudzhadzhi.agent@ticketiq.com' },
            ].map((r, i) => (
              <motion.div key={r.dept}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="rounded-lg border border-gray-800/60 p-3 bg-gray-900/40">
                <div className="flex items-center gap-2 mb-2">
                  <span className={clsx('w-2 h-2 rounded-full', ROUTING_CLASSES[r.color] || 'bg-slate-500')} />
                  <span className="text-xs font-semibold text-white">{r.dept}</span>
                </div>
                <p className="text-xs text-gray-400">→ <span className="text-blue-400 font-medium">{r.agent}</span></p>
                <p className="text-xs text-gray-600 mt-0.5 truncate">{r.email}</p>
              </motion.div>
            ))}
          </div>
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/60 bg-gray-900/40">
                    {['#', 'Title', 'Department', 'Priority', 'Status', 'Assigned To', 'Created'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {tickets.slice(0, 10).map((t, i) => (
                    <motion.tr key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="hover:bg-gray-900/40 transition cursor-pointer"
                      onClick={() => router.push(`/tickets/${t.id}`)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {t.is_escalated && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                          <span className="font-mono text-xs text-gray-500">{t.ticket_number}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white font-medium truncate max-w-[200px]">{t.title}</p>
                        {t.ai?.category && <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><Cpu className="w-3 h-3" />{t.ai.category}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {t.department ? <DepartmentBadge name={t.department.name} color={t.department.color} /> : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-3">
                        {t.assigned_agent ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 text-xs">
                              {t.assigned_agent.full_name?.charAt(0)}
                            </div>
                            <div>
                              <p className="text-xs text-gray-300">{t.assigned_agent.full_name?.split(' ')[0]}</p>
                              <p className="text-xs text-gray-600">{t.assigned_agent.agent_role_key?.replace(/_/g,' ')}</p>
                            </div>
                          </div>
                        ) : <span className="text-xs text-gray-600">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {t.created_at ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true }) : '—'}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
