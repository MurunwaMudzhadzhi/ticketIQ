/**
 * TicketIQ — Ticket List Page
 * ==============================
 * A filterable, sortable, dual-view (table or card) list of tickets.
 * The page title changes based on the logged-in user's role (e.g.
 * "HR Queue" for the AI Intern, "My Tickets" for an employee) purely
 * as a label — the actual ticket scoping is already done server-side
 * by ticketsApi.list() (see get_tickets_for_user() in the backend's
 * ticket_service.py); this page never needs its own role-based
 * filtering logic, only the cosmetic title.
 *
 * All search/filter/sort below happens entirely client-side over the
 * already-fetched ticket list — fine at this app's scale, but would
 * need to move server-side (with pagination) if ticket volume ever
 * grew large enough that fetching the full list up front became slow.
 */
'use client'
import { useState, useEffect, useMemo } from 'react'
import DashboardLayout from '@/components/shared/DashboardLayout'
import { PriorityBadge, StatusBadge, DepartmentBadge } from '@/components/ui/TicketBadge'
import { ticketsApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  Search, Plus, Cpu, LayoutList, LayoutGrid, ArrowUpDown,
  ArrowUp, ArrowDown, Clock, CheckCircle, AlertTriangle,
  Ticket, User, ChevronRight, Filter, X, SlidersHorizontal,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { formatDistanceToNow, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import clsx from 'clsx'

// Same SAST-everywhere convention as the other pages — see
// tickets/[id]/page.tsx's module header for the rationale.
const SAST = 'Africa/Johannesburg'

function toSAST(iso?: string) {
  if (!iso) return '—'
  try {
    return format(toZonedTime(new Date(iso), SAST), 'dd MMM yyyy, HH:mm')
  } catch { return iso }
}
function relSAST(iso?: string) {
  if (!iso) return '—'
  try {
    return formatDistanceToNow(toZonedTime(new Date(iso), SAST), { addSuffix: true })
  } catch { return '—' }
}

type SortField = 'created_at' | 'priority' | 'status' | 'title'
type SortDir   = 'asc' | 'desc'
type ViewMode  = 'table' | 'card'

// Explicit sort-order rankings (lower number = sorts first) — needed
// because priority/status are just strings, with no natural
// alphabetical order that matches their real-world urgency (e.g.
// "critical" should sort before "low", but alphabetically "critical"
// comes before "high" too, which isn't the order we actually want).
const PRIO_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const STATUS_ORDER: Record<string, number> = {
  escalated: 0, open: 1, in_progress: 2, assigned: 3, pending: 4,
  waiting_for_user: 5, resolved: 6, closed: 7,
}

/** A clickable column header that toggles sort direction and shows an up/down arrow when active. */
function SortButton({ field, label, current, dir, onSort }: {
  field: SortField; label: string; current: SortField; dir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = current === field
  return (
    <button onClick={() => onSort(field)}
      className={clsx('flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition',
        active ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300')}>
      {label}
      {active ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) :
        <ArrowUpDown className="w-3 h-3 opacity-40" />}
    </button>
  )
}

/** A small rounded stat pill shown in the stats bar above the ticket list (e.g. "● Open 4"). */
function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900 border border-gray-800/60">
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', color)} />
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-bold text-white">{value}</span>
    </div>
  )
}

export default function TicketsPage() {
  const { user } = useAuthStore()
  const router   = useRouter()

  const [tickets, setTickets]               = useState<any[]>([])
  const [search, setSearch]                 = useState('')
  const [statusFilter, setStatusFilter]     = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [deptFilter, setDeptFilter]         = useState('all')
  const [sortField, setSortField]           = useState<SortField>('created_at')
  const [sortDir, setSortDir]               = useState<SortDir>('desc')
  const [viewMode, setViewMode]             = useState<ViewMode>('table')
  const [loading, setLoading]               = useState(true)
  const [showFilters, setShowFilters]       = useState(false)

  useEffect(() => {
    ticketsApi.list()
      .then(({ data }) => setTickets(data.tickets || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // The page title is purely cosmetic labelling based on the logged-in
  // user's role — see the module header above for why this never
  // affects which tickets actually get fetched/shown.
  const role = (user as any)?.agent_role_key || user?.role || 'employee'
  const titleMap: Record<string, string> = {
    employee:              'My Tickets',
    ai_intern:             'HR Queue',
    it_support_technician: 'IT & Finance Queue',
    junior_operations:     'Operations Queue',
    admin:                 'All Tickets',
    super_admin:           'All Tickets',
  }
  const pageTitle = titleMap[role] || 'Tickets'

  // Unique departments for filter — derived from whatever's actually
  // present in the loaded tickets, rather than a fixed list, so the
  // filter dropdown never offers a department with zero matching tickets.
  const departments = useMemo(() => {
    const names = new Set<string>()
    tickets.forEach(t => { if (t.department?.name) names.add(t.department.name) })
    return [...names].sort()
  }, [tickets])

  // Stats shown in the pills above the toolbar — computed from the
  // FULL ticket list (not the filtered list), so these numbers stay
  // stable as the person types in the search box or changes filters.
  const stats = useMemo(() => ({
    total:     tickets.length,
    open:      tickets.filter(t => t.status === 'open').length,
    escalated: tickets.filter(t => t.is_escalated).length,
    resolved:  tickets.filter(t => ['resolved','closed'].includes(t.status)).length,
    critical:  tickets.filter(t => t.priority === 'critical').length,
  }), [tickets])

  // Clicking the same column again flips direction; clicking a
  // different column switches to it and resets to ascending.
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  // The actual search/filter/sort pipeline — re-computed only when one
  // of its dependencies changes (via useMemo), applied in this order:
  // text search -> status/priority/department filters -> sort.
  const filtered = useMemo(() => {
    let r = tickets
    if (search)
      r = r.filter(t =>
        t.title?.toLowerCase().includes(search.toLowerCase()) ||
        t.ticket_number?.toLowerCase().includes(search.toLowerCase()) ||
        t.submitter?.full_name?.toLowerCase().includes(search.toLowerCase())
      )
    if (statusFilter !== 'all')   r = r.filter(t => t.status === statusFilter)
    if (priorityFilter !== 'all') r = r.filter(t => t.priority === priorityFilter)
    if (deptFilter !== 'all')     r = r.filter(t => t.department?.name === deptFilter)

    return [...r].sort((a, b) => {
      let cmp = 0
      if (sortField === 'created_at') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      } else if (sortField === 'priority') {
        cmp = (PRIO_ORDER[a.priority] ?? 99) - (PRIO_ORDER[b.priority] ?? 99)
      } else if (sortField === 'status') {
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
      } else if (sortField === 'title') {
        cmp = (a.title || '').localeCompare(b.title || '')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [tickets, search, statusFilter, priorityFilter, deptFilter, sortField, sortDir])

  const activeFiltersCount = [
    search, statusFilter !== 'all' ? statusFilter : '',
    priorityFilter !== 'all' ? priorityFilter : '',
    deptFilter !== 'all' ? deptFilter : '',
  ].filter(Boolean).length

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setDeptFilter('all')
  }

  return (
    <DashboardLayout title={pageTitle} subtitle={`${filtered.length} of ${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}`}>

      {/* Stats bar */}
      {!loading && tickets.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <StatPill label="Total"     value={stats.total}     color="bg-gray-500" />
          <StatPill label="Open"      value={stats.open}      color="bg-blue-400" />
          <StatPill label="Escalated" value={stats.escalated} color="bg-red-400"  />
          <StatPill label="Critical"  value={stats.critical}  color="bg-orange-400" />
          <StatPill label="Resolved"  value={stats.resolved}  color="bg-green-400" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search title, number, or submitter…"
            aria-label="Search tickets"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(v => !v)}
          className={clsx('flex items-center gap-2 text-sm rounded-lg px-3 py-2 border transition',
            showFilters || activeFiltersCount > 0
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
              : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800')}>
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {activeFiltersCount > 0 && (
            <span className="text-xs bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {activeFiltersCount}
            </span>
          )}
        </button>

        {/* View mode */}
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-lg p-1">
          <button onClick={() => setViewMode('table')} aria-label="Switch to table view"
            className={clsx('p-1.5 rounded transition', viewMode === 'table' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}>
            <LayoutList className="w-4 h-4" aria-hidden="true" />
          </button>
          <button onClick={() => setViewMode('card')} aria-label="Switch to card view"
            className={clsx('p-1.5 rounded transition', viewMode === 'card' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300')}>
            <LayoutGrid className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {role === 'employee' && (
          <Link href="/tickets/new"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition">
            <Plus className="w-4 h-4" /> New Ticket
          </Link>
        )}
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="flex flex-wrap gap-3 mb-4 p-4 glass-card rounded-xl border border-gray-800/60">
              <select
                value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="all">All Status</option>
                {['open','pending','assigned','in_progress','escalated','waiting_for_user','resolved','closed'].map(s =>
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                )}
              </select>
              <select
                value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
                aria-label="Filter by priority"
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="all">All Priority</option>
                {['critical','high','medium','low'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {departments.length > 0 && (
                <select
                  value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                  aria-label="Filter by department"
                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="all">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {activeFiltersCount > 0 && (
                <button onClick={clearFilters}
                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition">
                  <X className="w-3.5 h-3.5" /> Clear filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      {loading ? (
        <div className="glass-card rounded-xl border border-gray-800/60 p-12 text-center text-gray-500 text-sm">
          Loading tickets…
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card rounded-xl border border-gray-800/60 p-12 text-center">
          <Ticket className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No tickets match your filters</p>
          {activeFiltersCount > 0 && (
            <button onClick={clearFilters} className="text-blue-400 text-sm mt-2 hover:text-blue-300 transition">
              Clear filters
            </button>
          )}
          {role === 'employee' && tickets.length === 0 && (
            <Link href="/tickets/new" className="text-blue-400 text-sm mt-1 inline-block">Submit your first ticket →</Link>
          )}
        </div>
      ) : viewMode === 'table' ? (

        /* ── TABLE VIEW ─────────────────────────────────────────────── */
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/60 bg-gray-900/40">
                  <th className="text-left px-4 py-3">
                    <SortButton field="title" label="#  Title" current={sortField} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Department</th>
                  <th className="text-left px-4 py-3">
                    <SortButton field="priority" label="Priority" current={sortField} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="text-left px-4 py-3">
                    <SortButton field="status" label="Status" current={sortField} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Agent</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Submitter</th>
                  <th className="text-left px-4 py-3">
                    <SortButton field="created_at" label="Submitted" current={sortField} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/40">
                {filtered.map((t, i) => (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}
                    className="hover:bg-gray-900/40 transition cursor-pointer group"
                    onClick={() => router.push(`/tickets/${t.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        {t.is_escalated && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />}
                        <span className="font-mono text-xs text-gray-500">{t.ticket_number}</span>
                      </div>
                      <p className="text-white font-medium truncate max-w-xs">{t.title}</p>
                      {t.ai?.category && (
                        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                          <Cpu className="w-3 h-3 text-blue-400/60" /> {t.ai.category}
                        </p>
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
                      {t.assigned_agent ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 text-xs font-bold">
                            {t.assigned_agent.full_name?.charAt(0)}
                          </div>
                          <span className="text-xs text-gray-400">{t.assigned_agent.full_name?.split(' ')[0]}</span>
                        </div>
                      ) : <span className="text-xs text-gray-600">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3">
                      {t.submitter ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 text-xs font-bold">
                            {t.submitter.full_name?.charAt(0)}
                          </div>
                          <span className="text-xs text-gray-400">{t.submitter.full_name?.split(' ')[0]}</span>
                        </div>
                      ) : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-400">{toSAST(t.created_at)}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{relSAST(t.created_at)}</p>
                      {t.sla_deadline && (
                        <p className={clsx('text-xs mt-0.5 flex items-center gap-1',
                          t.sla_breached ? 'text-red-400' : 'text-gray-600')}>
                          <Clock className="w-3 h-3" />
                          SLA: {format(toZonedTime(new Date(t.sla_deadline), SAST), 'dd MMM HH:mm')}
                          {t.sla_breached && ' ⚠'}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition" />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      ) : (

        /* ── CARD VIEW ──────────────────────────────────────────────── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className="glass-card rounded-xl border border-gray-800/60 p-4 hover:border-gray-700/80 transition cursor-pointer group"
              onClick={() => router.push(`/tickets/${t.id}`)}>
              {/* Card top */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    {t.is_escalated && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                    <span className="font-mono text-xs text-gray-500">{t.ticket_number}</span>
                  </div>
                  <p className="text-sm font-semibold text-white leading-snug line-clamp-2">{t.title}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition flex-shrink-0 mt-1" />
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <PriorityBadge priority={t.priority} />
                <StatusBadge status={t.status} />
                {t.department && <DepartmentBadge name={t.department.name} color={t.department.color} />}
              </div>

              {/* AI category */}
              {t.ai?.category && (
                <p className="text-xs text-gray-500 flex items-center gap-1 mb-3">
                  <Cpu className="w-3 h-3 text-blue-400/60" /> {t.ai.category}
                </p>
              )}

              {/* Footer */}
              <div className="pt-3 border-t border-gray-800/40 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {t.submitter && (
                    <>
                      <div className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 text-xs font-bold">
                        {t.submitter.full_name?.charAt(0)}
                      </div>
                      <span className="text-xs text-gray-500">{t.submitter.full_name?.split(' ')[0]}</span>
                    </>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">{relSAST(t.created_at)}</p>
                  {t.sla_breached && (
                    <p className="text-xs text-red-400 flex items-center gap-1 justify-end mt-0.5">
                      <AlertTriangle className="w-3 h-3" /> SLA breached
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}