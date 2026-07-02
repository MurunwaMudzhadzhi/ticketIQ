/**
 * TicketIQ — Department Reports Page
 * =====================================
 * Route: /reports/departments  (or drop into /analytics/departments)
 *
 * Features:
 *  - Department selector tabs (HR / IT / Finance / Operations + All)
 *  - KPI cards: total, open, in_progress, resolved, escalated, critical
 *  - Status breakdown bar chart
 *  - Priority breakdown donut chart
 *  - SLA compliance gauge
 *  - Agent performance table
 *  - Recent ticket list for the selected department
 */
'use client'

import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '@/components/shared/DashboardLayout'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'
import {
  Building2, Ticket, Clock, CheckCircle, AlertTriangle,
  TrendingUp, Shield, Users, ChevronRight, Cpu, RefreshCw,
} from 'lucide-react'
import { PriorityBadge, StatusBadge, DepartmentBadge } from '@/components/ui/TicketBadge'
import { formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Department {
  id: string
  name: string
  slug: string
  color: string
}

interface Overview {
  total: number
  open: number
  in_progress: number
  resolved: number
  escalated: number
  critical: number
}

interface StatusPoint  { status: string;   count: number }
interface PriorityPoint { priority: string; count: number }

interface SLAStats {
  total: number
  breached: number
  at_risk: number
  on_track: number
  breach_rate: number
  avg_resolution_hours: number | null
  by_priority: { priority: string; total: number; breached: number; rate: number }[]
}

interface AgentPerf {
  id: string
  name: string
  role: string
  total: number
  resolved: number
  in_progress: number
  escalated: number
  resolution_rate: number
  avg_resolution_hours: number | null
}

interface Ticket {
  id: string
  ticket_number: string
  title: string
  status: string
  priority: string
  created_at: string
  is_escalated: boolean
  department?: { name: string; color: string }
  assigned_agent?: { full_name: string; agent_role_key: string }
  ai?: { category: string }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_DEPT: Department = { id: 'all', name: 'All Departments', slug: 'all', color: '#6366F1' }

const STATUS_COLORS: Record<string, string> = {
  open:        '#3B82F6',
  in_progress: '#A855F7',
  assigned:    '#F59E0B',
  resolved:    '#10B981',
  escalated:   '#EF4444',
  closed:      '#6B7280',
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444',
  high:     '#F97316',
  medium:   '#EAB308',
  low:      '#22C55E',
}

function getToken(): string | null {
  try { return localStorage.getItem('access_token') } catch { return null }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPI({
  label, value, icon: Icon, color, sub,
}: {
  label: string; value: number | string; icon: React.ElementType
  color: string; sub?: string
}) {
  const colorMap: Record<string, string> = {
    blue:   'bg-blue-500/10   border-blue-500/20   text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    green:  'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    red:    'bg-red-500/10    border-red-500/20    text-red-400',
    amber:  'bg-amber-500/10  border-amber-500/20  text-amber-400',
    indigo: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
  }
  return (
    <div className="glass-card rounded-xl p-5 border border-gray-800/60">
      <div className={clsx('inline-flex h-9 w-9 items-center justify-center rounded-xl border mb-3', colorMap[color])}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-1">{sub}</div>}
    </div>
  )
}

function SLAGauge({ rate }: { rate: number }) {
  const color = rate >= 80 ? '#10B981' : rate >= 60 ? '#F59E0B' : '#EF4444'
  const label = rate >= 80 ? 'Healthy' : rate >= 60 ? 'At Risk' : 'Critical'
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-4">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#1F2937" strokeWidth="12" />
          <circle
            cx="60" cy="60" r="50" fill="none"
            stroke={color} strokeWidth="12"
            strokeDasharray={`${(rate / 100) * 314} 314`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
          <span className="text-2xl font-bold text-white">{rate}%</span>
          <span className="text-xs font-medium" style={{ color }}>{label}</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 text-center">SLA Compliance Rate</p>
    </div>
  )
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-semibold text-white">{p.value} tickets</p>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DepartmentReportPage() {
  const router = useRouter()
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

  const [departments, setDepartments]   = useState<Department[]>([ALL_DEPT])
  const [selected, setSelected]         = useState<Department>(ALL_DEPT)
  const [overview, setOverview]         = useState<Overview | null>(null)
  const [statusData, setStatusData]     = useState<StatusPoint[]>([])
  const [priorityData, setPriorityData] = useState<PriorityPoint[]>([])
  const [sla, setSla]                   = useState<SLAStats | null>(null)
  const [agents, setAgents]             = useState<AgentPerf[]>([])
  const [tickets, setTickets]           = useState<Ticket[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [lastRefresh, setLastRefresh]   = useState<Date>(new Date())

  // ── Load department list once (hardcoded) ──────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setDepartments([
      ALL_DEPT,
      { id: '20643e4d-cf63-4c13-a1d0-75796d3a700b', name: 'Human Resources',        slug: 'hr',         color: '#8B5CF6' },
      { id: '0c3aab1e-7c26-47ea-9147-0cb2a30ec6cb', name: 'Information Technology', slug: 'it',         color: '#3B82F6' },
      { id: '54f588b3-3462-4499-8c97-79163273a5bf', name: 'Finance',                slug: 'finance',    color: '#10B981' },
      { id: '32ba6171-77bb-49b1-b9f6-33676fd39a71', name: 'Operations',             slug: 'operations', color: '#F59E0B' },
    ])
  }, [])

  // ── Load data for selected department ─────────────────────────────────────
  const loadData = useCallback(async () => {
    const token = getToken()
    if (!token) { setError('Not authenticated'); setLoading(false); return }

    setLoading(true)
    setError(null)

    const deptParam = selected.id !== 'all' ? `?department_id=${selected.id}` : ''
    const headers   = { Authorization: `Bearer ${token}` }

    try {
      const [ovRes, stRes, prRes, slRes, agRes, txRes] = await Promise.all([
        fetch(`${API}/analytics/overview${deptParam}`,           { headers }),
        fetch(`${API}/analytics/by-status${deptParam}`,          { headers }),
        fetch(`${API}/analytics/by-priority${deptParam}`,        { headers }),
        fetch(`${API}/analytics/sla${deptParam}`,                { headers }),
        fetch(`${API}/analytics/agent-performance${deptParam}`,  { headers }),
        fetch(`${API}/tickets/?limit=10`,             { headers }),
      ])

      // Parse — don't crash if one endpoint 404s
      const safeJson = async (res: Response) => res.ok ? res.json() : null

      const [ov, st, pr, sl, ag, tx] = await Promise.all([
        safeJson(ovRes), safeJson(stRes), safeJson(prRes),
        safeJson(slRes), safeJson(agRes), safeJson(txRes),
      ])

      if (ov) setOverview(ov)
      if (st) setStatusData(Array.isArray(st) ? st : (st.data ?? []))
      if (pr) setPriorityData(Array.isArray(pr) ? pr : (pr.data ?? []))
      if (sl) setSla(sl)
      if (ag) setAgents(Array.isArray(ag) ? ag : (ag.agents ?? ag.data ?? []))
      if (tx) setTickets(tx.tickets ?? tx.data ?? [])

      setLastRefresh(new Date())
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [API, selected])

  useEffect(() => { loadData() }, [loadData])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout
      title="Department Reports"
      subtitle="Per-department ticket analytics, SLA, and agent performance"
      requiredRoles={['admin', 'super_admin']}
    >
      <div className="space-y-6">

        {/* ── Department selector ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            {departments.map(dept => (
              <button
                key={dept.id}
                onClick={() => setSelected(dept)}
                className={clsx(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all',
                  selected.id === dept.id
                    ? 'text-white shadow-lg'
                    : 'bg-gray-900/60 border border-gray-800/60 text-gray-400 hover:text-white hover:border-gray-600'
                )}
                style={selected.id === dept.id ? {
                  background: `${dept.color}22`,
                  border: `1px solid ${dept.color}55`,
                  color: dept.color,
                } : {}}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: dept.color }}
                />
                {dept.name}
              </button>
            ))}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-gray-400 hover:text-white transition"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* ── Department header ── */}
        <div
          className="rounded-xl border p-4 flex items-center gap-3"
          style={{ background: `${selected.color}0D`, borderColor: `${selected.color}33` }}
        >
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: `${selected.color}22` }}
          >
            <Building2 className="w-5 h-5" style={{ color: selected.color }} />
          </div>
          <div>
            <div className="font-semibold text-white">{selected.name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Last updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ── KPI cards ── */}
        {overview && (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KPI label="Total Tickets"  value={overview.total}       icon={Ticket}        color="blue"   />
            <KPI label="Open"           value={overview.open}        icon={Clock}         color="indigo" />
            <KPI label="In Progress"    value={overview.in_progress} icon={TrendingUp}    color="purple" />
            <KPI label="Resolved"       value={overview.resolved}    icon={CheckCircle}   color="green"  />
            <KPI label="Escalated"      value={overview.escalated}   icon={AlertTriangle} color="red"    />
            <KPI label="Critical"       value={overview.critical}    icon={Shield}        color="red"    />
          </div>
        )}

        {loading && !overview && (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-5 border border-gray-800/60 animate-pulse h-28 bg-gray-800/40" />
            ))}
          </div>
        )}

        {/* ── Charts row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Status breakdown */}
          <div className="lg:col-span-2 glass-card rounded-xl p-5 border border-gray-800/60">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              Tickets by Status
            </h2>
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statusData} margin={{ left: -20 }}>
                  <XAxis
                    dataKey="status"
                    tick={{ fill: '#6B7280', fontSize: 11 }}
                    tickFormatter={s => s.replace('_', ' ')}
                    tickLine={false} axisLine={false}
                  />
                  <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.status] ?? '#6B7280'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
                {loading ? 'Loading…' : 'No data'}
              </div>
            )}
          </div>

          {/* Priority donut */}
          <div className="glass-card rounded-xl p-5 border border-gray-800/60">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              By Priority
            </h2>
            {priorityData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={priorityData} dataKey="count" nameKey="priority"
                      cx="50%" cy="50%" outerRadius={65} innerRadius={38}
                    >
                      {priorityData.map((entry, i) => (
                        <Cell key={i} fill={PRIORITY_COLORS[entry.priority] ?? '#6B7280'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#1F2937', border: '1px solid #374151', borderRadius: 8 }}
                      labelStyle={{ color: '#F9FAFB' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="w-full space-y-1.5 mt-2">
                  {priorityData.map(p => (
                    <div key={p.priority} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLORS[p.priority] }} />
                        <span className="capitalize text-gray-400">{p.priority}</span>
                      </span>
                      <span className="font-bold text-white">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
                {loading ? 'Loading…' : 'No data'}
              </div>
            )}
          </div>
        </div>

        {/* ── SLA + Avg Resolution ── */}
        {sla && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="glass-card rounded-xl p-5 border border-gray-800/60 flex flex-col items-center justify-center">
              <SLAGauge rate={Math.round(sla.breach_rate ? (100 - sla.breach_rate) : 0)} />
            </div>
            <div className="glass-card rounded-xl p-5 border border-gray-800/60 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                SLA Breakdown
              </h2>
              {[
                { label: 'Within SLA',          value: sla.on_track ?? 0,                     color: '#10B981' },
                { label: 'Breached',             value: sla.breached,                       color: '#EF4444' },
                { label: 'Compliance Rate',      value: `${Math.round(sla.breach_rate ? (100 - sla.breach_rate) : 0)}%`, color: '#6366F1' },
                { label: 'Avg Resolution',       value: sla.avg_resolution_hours != null ? `${sla.avg_resolution_hours.toFixed(1)}h` : '—', color: '#F59E0B' },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between border-b border-gray-800/60 pb-2 last:border-0 last:pb-0">
                  <span className="text-xs text-gray-400">{row.label}</span>
                  <span className="text-sm font-bold" style={{ color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className="glass-card rounded-xl p-5 border border-gray-800/60">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                Resolution Speed
              </h2>
              <div className="space-y-3">
                {[
                  { label: 'Avg Resolution Time', value: sla.avg_resolution_hours != null ? `${sla.avg_resolution_hours.toFixed(1)}h` : 'N/A' },
                  { label: 'Target SLA',           value: '< 24h' },
                  { label: 'Within SLA',           value: `${sla.on_track ?? 0} tickets` },
                  { label: 'Breached SLA',         value: `${sla.breached} tickets` },
                ].map(row => (
                  <div key={row.label} className="flex justify-between text-xs">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="text-white font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Agent performance table ── */}
        {agents.length > 0 && (
          <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800/60 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-gray-300">Agent Performance</h2>
              <span className="ml-auto text-xs text-gray-600 font-mono">{agents.length} agents</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/60 bg-gray-900/40">
                    {['Agent', 'Role', 'Assigned', 'Resolved', 'Escalated', 'Avg Resolution'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/40">
                  {agents.map(agent => {
                    const resolveRate = agent.total > 0
                      ? Math.round((agent.resolved / agent.total) * 100)
                      : 0
                    return (
                      <tr key={agent.id} className="hover:bg-gray-900/40 transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 text-xs font-bold">
                              {(agent.name ?? '?').charAt(0)}
                            </div>
                            <span className="text-white text-xs font-medium">{agent.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 capitalize">
                          {agent.role?.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-white">{agent.total}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-white">{agent.resolved}</span>
                            <div className="h-1.5 w-16 rounded-full bg-gray-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-all"
                                style={{ width: `${resolveRate}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{resolveRate}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx(
                            'text-xs font-mono',
                            agent.escalated > 0 ? 'text-red-400' : 'text-gray-500'
                          )}>
                            {agent.escalated}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-amber-400">
                          {agent.avg_resolution_hours != null
                            ? `${agent.avg_resolution_hours.toFixed(1)}h`
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Recent tickets ── */}
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800/60 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Ticket className="w-4 h-4 text-blue-400" />
              Recent Tickets
              {selected.id !== 'all' && (
                <span className="ml-1 text-xs font-normal text-gray-500">· {selected.name}</span>
              )}
            </h2>
            <button
              onClick={() => router.push('/tickets')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-gray-600 text-sm">No tickets found for this department.</div>
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
                  {tickets.slice(0, 10).map(t => (
                    <tr
                      key={t.id}
                      className="hover:bg-gray-900/40 transition cursor-pointer"
                      onClick={() => router.push(`/tickets/${t.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {t.is_escalated && (
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                          )}
                          <span className="font-mono text-xs text-gray-500">{t.ticket_number}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-white font-medium truncate max-w-[180px]">{t.title}</p>
                        {t.ai?.category && (
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            <Cpu className="w-3 h-3" />{t.ai.category}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.department
                          ? <DepartmentBadge name={t.department.name} color={t.department.color} />
                          : <span className="text-gray-600 text-xs">—</span>}
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
                              <p className="text-xs text-gray-600">{t.assigned_agent.agent_role_key?.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                        ) : <span className="text-xs text-gray-600">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {t.created_at
                          ? formatDistanceToNow(new Date(t.created_at), { addSuffix: true })
                          : '—'}
                      </td>
                    </tr>
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
