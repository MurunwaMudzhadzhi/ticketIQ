'use client'
import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/shared/DashboardLayout'
import { analyticsApi, downloadWeeklyInsightsReport } from '@/lib/api'
import ForecastPanel from '@/components/ui/ForecastPanel'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import {
  Ticket, CheckCircle, AlertTriangle, Clock, TrendingUp,
  Users, Shield, Zap, Activity, Target, BarChart3, RefreshCw,
  FileText, Download, Sparkles, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

const PRIO_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
}
const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6', pending: '#eab308', assigned: '#06b6d4',
  in_progress: '#8b5cf6', escalated: '#ef4444', resolved: '#22c55e', closed: '#6b7280',
}
const DEPT_COLORS: Record<string, string> = {
  'Human Resources': '#8B5CF6', 'Information Technology': '#3B82F6',
  'Finance': '#10B981', 'Operations': '#F59E0B',
}
const AGENT_ROLE_LABELS: Record<string, string> = {
  ai_intern: 'AI Intern', it_support_technician: 'IT Support', junior_operations: 'Jr. Operations',
}
const ACTION_LABELS: Record<string, string> = {
  ticket_created: 'New ticket', status_changed: 'Status updated',
  ticket_escalated: 'Escalated', ticket_assigned: 'Assigned',
}

const CARD_COLORS: Record<string, string> = {
  blue:   'text-blue-400 bg-blue-500/10',
  green:  'text-green-400 bg-green-500/10',
  red:    'text-red-400 bg-red-500/10',
  purple: 'text-purple-400 bg-purple-500/10',
  amber:  'text-amber-400 bg-amber-500/10',
  cyan:   'text-cyan-400 bg-cyan-500/10',
}

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: any; icon: any; color: string; sub?: string
}) {
  const c = CARD_COLORS[color] ?? CARD_COLORS.blue
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-4 border border-gray-800/60">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">{label}</p>
        <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', c.split(' ')[1])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className={clsx('text-2xl font-bold', c.split(' ')[0])}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </motion.div>
  )
}

const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-gray-400 mb-1 font-medium">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill }}>
          {p.name}: <span className="font-bold text-white">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-800/60">
        <Icon className="w-4 h-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-gray-300">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const [overview,    setOverview]    = useState<any>({})
  const [deptData,    setDeptData]    = useState<any[]>([])
  const [prioData,    setPrioData]    = useState<any[]>([])
  const [statusData,  setStatusData]  = useState<any[]>([])
  const [agents,      setAgents]      = useState<any[]>([])
  const [sla,         setSla]         = useState<any>({})
  const [trends,      setTrends]      = useState<any[]>([])
  const [activity,    setActivity]    = useState<any[]>([])
  const [insights,    setInsights]    = useState<any>(null)
  const [loading,     setLoading]     = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const load = () => {
    setLoading(true)
    Promise.all([
      analyticsApi.overview(),
      analyticsApi.byDepartment(),
      analyticsApi.byPriority(),
      analyticsApi.byStatus(),
      analyticsApi.agentPerformance(),
      analyticsApi.sla(),
      analyticsApi.trends(),
      analyticsApi.recentActivity(),
      analyticsApi.weeklyInsights(),
    ]).then(([ov, dept, prio, status, ag, slaR, tr, act, wk]) => {
      setOverview(ov.data)
      setDeptData(dept.data)
      setPrioData(prio.data)
      setStatusData(status.data)
      setAgents(ag.data)
      setSla(slaR.data)
      setTrends(tr.data)
      setActivity(act.data)
      setInsights(wk.data)
      setLastRefresh(new Date())
    }).catch(console.error).finally(() => setLoading(false))
  }

  // Separate handler (rather than reusing `load`) because downloading the
  // weekly report is a one-off file-save action with its own loading
  // state and error toast — it shouldn't re-fetch or re-render the rest
  // of the dashboard's charts.
  const handleDownload = async () => {
    setDownloading(true)
    try {
      await downloadWeeklyInsightsReport()
      toast.success('Weekly insights report downloaded.')
    } catch (err) {
      toast.error('Could not download the report. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <DashboardLayout title="Analytics" subtitle="System-wide performance metrics" requiredRoles={['admin', 'super_admin']}>
      <div className="space-y-6">

        {/* Refresh */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600">
            Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
          </p>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-400 transition disabled:opacity-50">
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Total Tickets"  value={overview.total}        icon={Ticket}        color="blue"   />
          <StatCard label="Open"           value={overview.open}         icon={Clock}         color="cyan"   />
          <StatCard label="In Progress"    value={overview.in_progress}  icon={TrendingUp}    color="purple" />
          <StatCard label="Resolved"       value={overview.resolved}     icon={CheckCircle}   color="green"  sub={`${overview.resolution_rate ?? 0}% rate`} />
          <StatCard label="Escalated"      value={overview.escalated}    icon={AlertTriangle} color="red"    />
          <StatCard label="SLA Breached"   value={overview.sla_breached} icon={Shield}        color="amber"  sub={`${sla.breach_rate ?? 0}% breach rate`} />
        </div>

        {/* Weekly Insights — Sprint 2 deliverable: AI-generated written
            summary of this week's activity, with a button to download it
            as a standalone report. See backend/app/services/analytics/
            weekly_insights.py for how this narrative is generated. */}
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-gray-800/60">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-gray-300">Weekly Insights</h2>
              {insights && (
                <span className="text-xs text-gray-600 font-mono">
                  {insights.generated_by === 'groq' ? 'AI-generated' : 'auto-generated'}
                </span>
              )}
            </div>
            <button onClick={handleDownload} disabled={downloading || !insights}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition bg-blue-500/10 hover:bg-blue-500/15 px-3 py-1.5 rounded-lg">
              {downloading
                ? <><div className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> Preparing…</>
                : <><Download className="w-3.5 h-3.5" /> Download report</>}
            </button>
          </div>
          <div className="p-5">
            {!insights ? (
              <div className="h-24 flex items-center justify-center text-gray-600 text-sm">Loading insights…</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Narrative */}
                <div className="lg:col-span-2">
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{insights.narrative}</p>
                </div>
                {/* Quick stat callouts alongside the narrative */}
                <div className="space-y-3 lg:border-l lg:border-gray-800/60 lg:pl-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">New this week</span>
                    <span className="flex items-center gap-1 text-sm font-bold text-white">
                      {insights.volume.created_this_week}
                      {insights.volume.created_change_pct != null && (
                        <span className={clsx('flex items-center text-xs font-medium',
                          insights.volume.created_change_pct >= 0 ? 'text-amber-400' : 'text-green-400')}>
                          {insights.volume.created_change_pct >= 0
                            ? <ArrowUpRight className="w-3 h-3" />
                            : <ArrowDownRight className="w-3 h-3" />}
                          {Math.abs(insights.volume.created_change_pct)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Busiest department</span>
                    <span className="text-sm font-bold text-white">{insights.busiest_department?.name ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">SLA breach rate</span>
                    <span className="text-sm font-bold text-white">{insights.sla.breach_rate}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Avg. resolution time</span>
                    <span className="text-sm font-bold text-white">
                      {insights.avg_resolution_hours != null ? `${insights.avg_resolution_hours}h` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trend + Status */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <SectionCard title="7-Day Ticket Trend" icon={TrendingUp}>
              {trends.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trends} margin={{ left: -20, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <Tooltip content={<ChartTip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                    <Line type="monotone" dataKey="created"  name="Created"  stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data yet</div>}
            </SectionCard>
          </div>

          <SectionCard title="By Status" icon={Activity}>
            <div className="space-y-3">
              {[...statusData].sort((a, b) => b.count - a.count).map(s => {
                const total = statusData.reduce((acc, x) => acc + x.count, 0)
                const pct = total ? Math.round(s.count / total * 100) : 0
                return (
                  <div key={s.status}>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-gray-400 capitalize">{s.status.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-bold text-white">{s.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[s.status] || '#6b7280' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>

        {/* Dept + Priority */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="Tickets by Department" icon={BarChart3}>
            {deptData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={deptData} margin={{ left: -20 }}>
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={n => n.split(' ')[0]} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                  <Bar dataKey="count" name="Total" radius={[4, 4, 0, 0]}>
                    {deptData.map((e, i) => <Cell key={i} fill={DEPT_COLORS[e.name] || '#3B82F6'} />)}
                  </Bar>
                  <Bar dataKey="resolved" name="Resolved" radius={[4, 4, 0, 0]} fill="#22c55e" opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data yet</div>}
          </SectionCard>

          <SectionCard title="Tickets by Priority" icon={AlertTriangle}>
            {prioData.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie data={prioData} dataKey="count" nameKey="priority"
                      cx="50%" cy="50%" outerRadius={80} innerRadius={50}>
                      {prioData.map((e, i) => <Cell key={i} fill={PRIO_COLORS[e.priority] || '#6b7280'} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3 flex-1">
                  {[...prioData].sort((a, b) => {
                    const ord = ['critical','high','medium','low']
                    return ord.indexOf(a.priority) - ord.indexOf(b.priority)
                  }).map(p => (
                    <div key={p.priority} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: PRIO_COLORS[p.priority] }} />
                      <span className="text-xs text-gray-400 capitalize flex-1">{p.priority}</span>
                      <span className="text-xs font-bold text-white">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data yet</div>}
          </SectionCard>
        </div>

        {/* Agent Performance */}
        <SectionCard title="Agent Performance" icon={Users}>
          {agents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/60">
                    {['Agent', 'Role', 'Assigned', 'Resolved', 'In Progress', 'Escalated', 'Resolution Rate'].map(h => (
                      <th key={h} className="text-left pb-3 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {agents.map((a, i) => (
                    <motion.tr key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                      className="hover:bg-gray-900/30 transition">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {a.name.charAt(0)}
                          </div>
                          <span className="text-white text-xs font-medium">{a.name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-gray-400">{AGENT_ROLE_LABELS[a.role] ?? a.role}</td>
                      <td className="py-3 pr-4 text-xs font-bold text-white">{a.total}</td>
                      <td className="py-3 pr-4 text-xs font-bold text-green-400">{a.resolved}</td>
                      <td className="py-3 pr-4 text-xs font-bold text-purple-400">{a.in_progress}</td>
                      <td className="py-3 pr-4 text-xs font-bold text-red-400">{a.escalated}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden min-w-16">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${a.resolution_rate}%` }} />
                          </div>
                          <span className="text-xs text-green-400 font-bold">{a.resolution_rate}%</span>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-gray-600 text-sm text-center py-6">No agent data</p>}
        </SectionCard>

        {/* SLA + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SectionCard title="SLA Overview" icon={Target}>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: 'On Track', value: sla.on_track ?? 0, color: 'text-green-400', bg: 'bg-green-500/10' },
                { label: 'At Risk',  value: sla.at_risk  ?? 0, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                { label: 'Breached', value: sla.breached ?? 0, color: 'text-red-400',   bg: 'bg-red-500/10'   },
              ].map(s => (
                <div key={s.label} className={clsx('rounded-xl p-3 text-center', s.bg)}>
                  <p className={clsx('text-xl font-bold', s.color)}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2.5">
              {(sla.by_priority || []).map((p: any) => (
                <div key={p.priority} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PRIO_COLORS[p.priority] }} />
                  <span className="text-xs text-gray-400 capitalize w-14">{p.priority}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${p.rate}%`, backgroundColor: PRIO_COLORS[p.priority] }} />
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right">{p.breached}/{p.total}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Recent Activity" icon={Zap}>
            {activity.length > 0 ? (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {activity.map((a, i) => (
                  <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300">
                        <span className="font-medium text-white">{a.user}</span>
                        {' — '}
                        <span className="text-gray-400">{ACTION_LABELS[a.action] ?? a.action}</span>
                        {a.ticket && <span className="text-blue-400 ml-1 font-mono">{a.ticket}</span>}
                      </p>
                      {a.ticket_title && <p className="text-xs text-gray-600 truncate">{a.ticket_title}</p>}
                      <p className="text-xs text-gray-700 mt-0.5">
                        {a.created_at ? formatDistanceToNow(new Date(a.created_at), { addSuffix: true }) : ''}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : <p className="text-gray-600 text-sm text-center py-6">No recent activity</p>}
          </SectionCard>
        </div>

        {/* Sprint 3 — 7-Day Predictive Forecast */}
        <ForecastPanel />

      </div>
    </DashboardLayout>
  )
}
