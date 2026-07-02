/**
 * TicketIQ — Top Header Bar
 * ============================
 * The fixed header shown above every dashboard page's content: page
 * title/subtitle on the left, and a notification bell + user menu on
 * the right. The notification bell is the most complex piece here —
 * it's a lightweight in-house notification system rather than a real
 * push/websocket feed: it just re-fetches the ticket list (see
 * fetchNotifs below) and filters down to whatever looks urgent
 * (escalated, critical priority, or still open), then tracks which of
 * those the user has "read" using a localStorage-persisted Set of IDs.
 *
 * All times displayed in this component are explicitly converted to
 * SAST (South Africa Standard Time) regardless of the visitor's
 * browser timezone — see toSAST()/relSAST() below — since this app is
 * built around Johannesburg-based offices and SLA deadlines should
 * read the same way for every user regardless of where their browser
 * happens to be configured.
 */
'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Bell, Search, LogOut, AlertTriangle, Clock, CheckCircle, X,
  BellOff, Trash2, MailOpen, Filter, RefreshCw, Info, Zap,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useRouter } from 'next/navigation'
import { authApi, ticketsApi } from '@/lib/api'
import toast from 'react-hot-toast'
import { formatDistanceToNow, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import clsx from 'clsx'
import Link from 'next/link'

const SAST = 'Africa/Johannesburg'

/** Format a UTC ISO string to SAST display time */
function toSAST(iso?: string) {
  if (!iso) return '—'
  try {
    const zoned = toZonedTime(new Date(iso), SAST)
    return format(zoned, 'dd MMM yyyy, HH:mm') + ' SAST'
  } catch {
    return iso
  }
}

/** Relative "N minutes ago" anchored to SAST */
function relSAST(iso?: string) {
  if (!iso) return ''
  try {
    const zoned = toZonedTime(new Date(iso), SAST)
    return formatDistanceToNow(zoned, { addSuffix: true })
  } catch {
    return ''
  }
}

interface NotifItem {
  id: string
  ticket_number: string
  title: string
  priority: string
  status: string
  is_escalated: boolean
  created_at: string
  read?: boolean
}

interface HeaderProps { title: string; subtitle?: string }

export default function Header({ title, subtitle }: HeaderProps) {
  const { user, clearAuth, refresh_token } = useAuthStore()
  const router = useRouter()

  const [showNotif, setShowNotif]     = useState(false)
  const [tickets,   setTickets]       = useState<NotifItem[]>([])
  // Which notification IDs the user has dismissed/read — persisted to
  // localStorage (see persistRead below) so "read" status survives a
  // page refresh, even though the underlying ticket list itself is
  // re-fetched fresh every time the panel opens.
  const [readIds,   setReadIds]       = useState<Set<string>>(new Set())
  const [filter,    setFilter]        = useState<'all' | 'unread' | 'escalated'>('all')
  const [loading,   setLoading]       = useState(false)
  const [lastFetch, setLastFetch]     = useState<Date | null>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // Persist read IDs to localStorage
  useEffect(() => {
    const stored = localStorage.getItem('tiq-notif-read')
    if (stored) {
      try { setReadIds(new Set(JSON.parse(stored))) } catch {}
    }
  }, [])

  const persistRead = (ids: Set<string>) => {
    localStorage.setItem('tiq-notif-read', JSON.stringify([...ids]))
  }

  // Time-of-day greeting shown next to the user's name, based on the
  // current hour in SAST specifically (not the visitor's local time) —
  // see the module header above for why SAST is used throughout.
  const greeting = () => {
    const h = toZonedTime(new Date(), SAST).getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  // Builds the notification list by re-using the existing ticket-list
  // endpoint (rather than a dedicated notifications API) and filtering
  // client-side down to whatever counts as "notification-worthy":
  // escalated, critical priority, or still sitting open. Escalated
  // tickets are always sorted first regardless of how recent they are,
  // since they represent the most urgent category.
  const fetchNotifs = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await ticketsApi.list()
      const all: NotifItem[] = data.tickets || []
      const notifs = all
        .filter(t => t.is_escalated || t.priority === 'critical' || t.status === 'open')
        .sort((a, b) => {
          if (a.is_escalated && !b.is_escalated) return -1
          if (!a.is_escalated && b.is_escalated) return 1
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
        .slice(0, 20)
      setTickets(notifs)
      setLastFetch(new Date())
    } catch {}
    finally { setLoading(false) }
  }, [])

  // Notifications are only fetched when the panel is actually opened
  // (not on a timer/poll) — re-fetches fresh every time it's reopened,
  // which keeps things simple at the cost of not being truly real-time
  // while the panel is closed.
  useEffect(() => {
    if (!showNotif) return
    fetchNotifs()
  }, [showNotif, fetchNotifs])

  // Close the notification panel when clicking anywhere outside it.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotif(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = async () => {
    // Same best-effort pattern as Sidebar's handleLogout: try to
    // revoke the refresh token server-side, but never let that failure
    // block the user from logging out locally.
    try { if (refresh_token) await authApi.logout(refresh_token) } catch {}
    clearAuth()
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ticketiq-auth')
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
    }
    toast.success('Signed out')
    router.push('/login')
  }

  const markRead = (id: string) => {
    const next = new Set([...readIds, id])
    setReadIds(next)
    persistRead(next)
  }

  const markAllRead = () => {
    const next = new Set([...readIds, ...tickets.map(t => t.id)])
    setReadIds(next)
    persistRead(next)
    toast.success('All notifications marked as read')
  }

  // "Clear all" marks everything read AND empties the visible list —
  // note this does NOT delete or dismiss anything server-side, since
  // there's no backend concept of a dismissed notification; the next
  // time fetchNotifs() runs, any ticket still matching the
  // notification-worthy filter (escalated/critical/open) will simply
  // reappear, just already marked as read.
  const clearAll = () => {
    const next = new Set([...readIds, ...tickets.map(t => t.id)])
    setReadIds(next)
    persistRead(next)
    setTickets([])
    toast.success('Notifications cleared')
  }

  const isRead = (id: string) => readIds.has(id)

  const displayed = tickets.filter(t => {
    if (filter === 'unread') return !isRead(t.id)
    if (filter === 'escalated') return t.is_escalated
    return true
  })

  const unreadCount = tickets.filter(t => !isRead(t.id)).length

  // Icon/colour lookup tables for each priority level, used both in
  // the notification list and (PRIO_COLOR) for the inline priority label.
  const PRIO_ICON: Record<string, React.ReactNode> = {
    critical: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
    high:     <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />,
    medium:   <Clock className="w-3.5 h-3.5 text-yellow-400" />,
    low:      <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  }

  const PRIO_COLOR: Record<string, string> = {
    critical: 'text-red-400',
    high:     'text-orange-400',
    medium:   'text-yellow-400',
    low:      'text-green-400',
  }

  return (
    <header className="h-16 bg-gray-950 border-b border-gray-800/60 flex items-center justify-between px-6 fixed top-0 left-64 right-0 z-30">
      <div>
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Search — NOTE: this input is currently decorative only; it
            has no onChange handler or connected state, so typing here
            doesn't filter or search anything yet. Wiring this up to
            actually filter the ticket list is a feature gap, not a bug
            in existing behaviour, since it never worked — flagging
            here so it's not mistaken for a working search box. */}
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input placeholder="Search tickets..."
            className="bg-gray-900 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48" />
        </div>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button onClick={() => setShowNotif(v => !v)}
            className="relative w-9 h-9 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center hover:bg-gray-800 transition">
            <Bell className="w-4 h-4 text-gray-400" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotif && (
            <div className="absolute right-0 top-11 w-96 glass-card rounded-xl border border-gray-700/60 shadow-2xl overflow-hidden z-50">

              {/* Panel Header */}
              <div className="px-4 py-3 border-b border-gray-800/60 bg-gray-900/60">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-gray-400" />
                    <p className="text-sm font-semibold text-white">Notifications</p>
                    {unreadCount > 0 && (
                      <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-medium">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={fetchNotifs}
                      title="Refresh notifications"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition">
                      <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
                    </button>
                    <button onClick={() => setShowNotif(false)} title="Close notifications" aria-label="Close notifications" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition">
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Filter tabs */}
                <div className="flex items-center gap-1">
                  {(['all', 'unread', 'escalated'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={clsx('text-xs px-2.5 py-1 rounded-full border transition capitalize',
                        filter === f
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                          : 'text-gray-500 border-gray-700/50 hover:border-gray-600 hover:text-gray-400'
                      )}>
                      {f}
                      {f === 'unread' && unreadCount > 0 && (
                        <span className="ml-1 text-red-400">({unreadCount})</span>
                      )}
                      {f === 'escalated' && (
                        <span className="ml-1 text-orange-400">
                          ({tickets.filter(t => t.is_escalated).length})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action bar */}
              {tickets.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/40 bg-gray-900/30">
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-400 transition">
                    <MailOpen className="w-3.5 h-3.5" /> Mark all read
                  </button>
                  <span className="text-gray-700">·</span>
                  <button
                    onClick={clearAll}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 transition">
                    <Trash2 className="w-3.5 h-3.5" /> Clear all
                  </button>
                  {lastFetch && (
                    <span className="ml-auto text-xs text-gray-600">
                      Updated {relSAST(lastFetch.toISOString())}
                    </span>
                  )}
                </div>
              )}

              {/* List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-800/40">
                {loading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : displayed.length === 0 ? (
                  <div className="py-10 text-center">
                    <BellOff className="w-6 h-6 text-gray-600 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">
                      {filter === 'unread' ? 'No unread notifications' :
                       filter === 'escalated' ? 'No escalated tickets' :
                       'All clear — no urgent tickets'}
                    </p>
                  </div>
                ) : (
                  displayed.map(t => (
                    <div
                      key={t.id}
                      className={clsx(
                        'flex items-start gap-3 px-4 py-3 transition group relative',
                        isRead(t.id)
                          ? 'hover:bg-gray-800/30 opacity-60'
                          : 'hover:bg-gray-800/50 bg-gray-900/20'
                      )}>
                      {/* Unread dot */}
                      {!isRead(t.id) && (
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400" />
                      )}

                      <div className="mt-0.5 flex-shrink-0">
                        {t.is_escalated
                          ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                          : PRIO_ICON[t.priority]}
                      </div>

                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/tickets/${t.id}`}
                          onClick={() => { markRead(t.id); setShowNotif(false) }}
                          className="block">
                          <p className="text-xs font-medium text-white truncate group-hover:text-blue-300 transition">{t.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="font-mono text-xs text-gray-600">{t.ticket_number}</span>
                            {t.is_escalated && (
                              <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Escalated</span>
                            )}
                            <span className={clsx('text-xs capitalize', PRIO_COLOR[t.priority])}>
                              {t.priority}
                            </span>
                            <span className="text-xs text-gray-600 capitalize">{t.status.replace(/_/g, ' ')}</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">{relSAST(t.created_at)}</p>
                        </Link>
                      </div>

                      {/* Per-item mark read */}
                      {!isRead(t.id) && (
                        <button
                          onClick={() => markRead(t.id)}
                          title="Mark as read"
                          aria-label="Mark notification as read"
                          className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 opacity-0 group-hover:opacity-100 transition">
                          <MailOpen className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-gray-800/60 flex items-center justify-between">
                <Link href="/tickets" onClick={() => setShowNotif(false)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition flex items-center gap-1">
                  <Zap className="w-3 h-3" /> View all tickets
                </Link>
                {lastFetch && (
                  <span className="text-xs text-gray-600">
                    {format(toZonedTime(lastFetch, SAST), 'HH:mm')} SAST
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User + logout */}
        <div className="flex items-center gap-2 pl-3 border-l border-gray-800">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-medium text-white">{greeting()}, {user?.full_name?.split(' ')[0]}</p>
            <p className="text-xs text-gray-500 capitalize">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
          <button onClick={handleLogout} title="Sign out"
            className="ml-2 w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 text-gray-500 transition">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}