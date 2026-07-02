/**
 * TicketIQ — Ticket Detail Page
 * ================================
 * The single most feature-dense page in the app: full ticket info, AI
 * classification/routing breakdown, agent status controls, a tabbed
 * comment thread (public replies vs internal-only notes), the
 * AI auto-response generator, and the self-help panel.
 *
 * Unlike the various dashboard list pages, this page calls
 * ticketsApi.get(id) — the single-ticket detail endpoint — which DOES
 * eager-load the full comment list server-side (see get_ticket() in
 * api/v1/endpoints/tickets.py), so ticket.comments here is genuinely
 * populated and safe to filter/map over directly.
 */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardLayout from '@/components/shared/DashboardLayout'
import { PriorityBadge, StatusBadge, DepartmentBadge } from '@/components/ui/TicketBadge'
import AutoResponsePanel from '@/components/ui/AutoResponsePanel'
import SelfHelpPanel from '@/components/ui/SelfHelpPanel'
import { ticketsApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Cpu, Send, Clock, User, MessageSquare,
  AlertTriangle, CheckCircle, ChevronDown, Sparkles,
  XCircle, RefreshCw, Shield, Zap, X, Reply, Users,
  Lock, Globe, ThumbsUp, Smile, Copy, ChevronRight,
  CornerDownRight, AtSign,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { useAuthStore } from '@/stores/authStore'
import clsx from 'clsx'

// All timestamps on this page display in SAST regardless of the
// visitor's own browser timezone — same rationale as Header.tsx: SLA
// deadlines and ticket times should read identically for every user
// since this app is built around Johannesburg-based support teams.
const SAST = 'Africa/Johannesburg'

/** Formats an ISO timestamp as an absolute SAST date/time string, e.g. "19 Jun 2026, 14:30 SAST". */
function toSAST(iso?: string) {
  if (!iso) return '—'
  try { return format(toZonedTime(new Date(iso), SAST), 'dd MMM yyyy, HH:mm') + ' SAST' }
  catch { return iso }
}
/** Formats an ISO timestamp as a relative SAST time, e.g. "2 hours ago". */
function relSAST(iso?: string) {
  if (!iso) return ''
  try { return formatDistanceToNow(toZonedTime(new Date(iso), SAST), { addSuffix: true }) }
  catch { return '' }
}

// Every possible ticket status an agent/admin can manually select —
// must stay in sync with the TicketStatus enum in the backend's models.py.
const STATUS_OPTIONS = [
  { value: 'open',             label: 'Open',             color: 'text-blue-400' },
  { value: 'pending',          label: 'Pending',          color: 'text-yellow-400' },
  { value: 'assigned',         label: 'Assigned',         color: 'text-cyan-400' },
  { value: 'in_progress',      label: 'In Progress',      color: 'text-purple-400' },
  { value: 'waiting_for_user', label: 'Waiting for User', color: 'text-gray-400' },
  { value: 'escalated',        label: 'Escalated',        color: 'text-red-400' },
  { value: 'resolved',         label: 'Resolved',         color: 'text-green-400' },
  { value: 'closed',           label: 'Closed',           color: 'text-gray-500' },
]

// ── Resolve Modal ──────────────────────────────────────────────────────────────
// A small confirmation dialog requiring a resolution note before a
// ticket can be marked resolved — see handleResolve() below, which
// both updates the status AND posts the note as a visible "Resolved: ..."
// comment, so the employee sees exactly what was done.
function ResolveModal({ onConfirm, onClose }: { onConfirm: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-md glass-card rounded-2xl border border-gray-700/60 p-6 z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-400" />
            </div>
            <h2 className="text-base font-bold text-white">Mark as Resolved</h2>
          </div>
          <button onClick={onClose} aria-label="Close modal" className="text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Provide a resolution note so the employee knows what was done.</p>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4}
          placeholder="Describe what was done to resolve this ticket…"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500 transition resize-none mb-4" />
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-2.5 text-sm font-medium transition">
            Cancel
          </button>
          <button onClick={() => { if (note.trim()) { onConfirm(note) } else { toast.error('Please add a resolution note') } }}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white rounded-lg py-2.5 text-sm font-medium transition flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4" /> Resolve Ticket
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Single comment card ────────────────────────────────────────────────────────
// Renders one message in the thread, with different left-border accent
// colours depending on what kind of comment it is (AI-generated,
// internal-only, a resolution note, or the current user's own message)
// — purely visual cues, computed via the clsx() conditional object below.
function CommentCard({
  c, onReply, onCopy, currentUserName,
}: {
  c: any;
  onReply: (name: string, id: string) => void;
  onCopy: (text: string) => void;
  currentUserName?: string;
}) {
  const isOwn = c.author?.full_name === currentUserName
  return (
    <div className={clsx('px-5 py-4 group', {
      'bg-blue-500/5 border-l-2 border-l-blue-500/30':   c.is_ai,
      'bg-yellow-500/5 border-l-2 border-l-yellow-500/30': c.is_internal,
      'bg-green-500/5 border-l-2 border-l-green-500/30':  c.content?.startsWith('Resolved:'),
      'bg-purple-500/5 border-l-2 border-l-purple-500/30': isOwn && !c.is_ai && !c.is_internal,
    })}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5',
          c.is_ai ? 'bg-blue-600' :
          isOwn   ? 'bg-gradient-to-br from-purple-500 to-blue-500' :
                    'bg-gradient-to-br from-blue-500 to-cyan-500')}>
          {c.is_ai ? <Cpu className="w-3.5 h-3.5" /> : (c.author?.full_name?.charAt(0) || '?')}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold text-gray-200">
              {c.is_ai ? 'AI Auto-Response' : c.author?.full_name}
              {isOwn && !c.is_ai && <span className="text-gray-500 font-normal ml-1">(you)</span>}
            </span>
            {c.is_internal && (
              <span className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Internal
              </span>
            )}
            {c.is_ai && (
              <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> AI
              </span>
            )}
            {!c.is_ai && !c.is_internal && (
              <span className="text-xs text-gray-500 bg-gray-800/40 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Globe className="w-2.5 h-2.5" /> Public
              </span>
            )}
            <span className="text-xs text-gray-600 ml-auto">{relSAST(c.created_at)}</span>
          </div>

          {/* Reply-to indicator */}
          {c.reply_to_name && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mb-1.5 italic">
              <CornerDownRight className="w-3 h-3" /> replying to {c.reply_to_name}
            </p>
          )}

          {/* Body */}
          <p className="text-sm text-gray-300 leading-relaxed">{c.content}</p>

          {/* Timestamp */}
          <p className="text-xs text-gray-600 mt-1.5">{toSAST(c.created_at)}</p>
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
          {!c.is_ai && (
            <button
              onClick={() => onReply(c.author?.full_name, c.id)}
              title="Reply to this comment"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition">
              <Reply className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onCopy(c.content)}
            title="Copy message"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function TicketDetailPage() {
  const { id }   = useParams() as { id: string }
  const router   = useRouter()
  const { user } = useAuthStore()

  const [ticket,         setTicket]         = useState<any>(null)
  const [loading,        setLoading]        = useState(true)
  const [comment,        setComment]        = useState('')
  const [isInternal,     setIsInternal]     = useState(false)
  const [posting,        setPosting]        = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [showResolve,    setShowResolve]    = useState(false)
  const [replyTo,        setReplyTo]        = useState<{ name: string; id: string } | null>(null)
  const [activeTab,      setActiveTab]      = useState<'thread' | 'activity'>('thread')

  const role           = user?.role || 'employee'
  const isAgentOrAdmin = ['ai_intern','it_support_technician','junior_operations','admin','super_admin'].includes(role)
  const isResolved     = ['resolved','closed'].includes(ticket?.status)

  const load = useCallback(async () => {
    try {
      const { data } = await ticketsApi.get(id)
      setTicket(data)
    } catch {
      toast.error('Could not load ticket')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // Posts a new comment. If replying to a specific earlier message
  // (see handleReply below), prefixes the content with "@Name: " so
  // the reply target is visible in the comment text itself — there's
  // no structured "reply-to" relationship in the data model, this is
  // purely a text convention.
  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!comment.trim()) return
    setPosting(true)
    const fullContent = replyTo
      ? `@${replyTo.name}: ${comment.trim()}`
      : comment.trim()
    try {
      await ticketsApi.addComment(id, fullContent, isInternal)
      setComment('')
      setReplyTo(null)
      toast.success(isInternal ? 'Internal note added' : 'Reply sent')
      load()  // re-fetch the whole ticket rather than optimistically appending, so the new comment's server-assigned id/timestamp are correct
    } catch { toast.error('Failed to send reply') }
    finally { setPosting(false) }
  }

  // Changing status to "resolved" specifically is intercepted and
  // redirected to the ResolveModal instead — resolving always requires
  // a note (see handleResolve below), every other status change does not.
  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === 'resolved') { setShowResolve(true); return }
    setStatusChanging(true)
    try {
      await ticketsApi.updateStatus(id, newStatus)
      toast.success(`Status → ${newStatus.replace(/_/g, ' ')}`)
      load()
    } catch { toast.error('Failed to update status') }
    finally { setStatusChanging(false) }
  }

  // Resolving a ticket does two things: updates the status (with the
  // note stored server-side as resolution_note) AND posts that same
  // note as a visible "Resolved: ..." comment in the thread — so the
  // employee sees what was done without needing to look anywhere else.
  const handleResolve = async (note: string) => {
    setShowResolve(false)
    setStatusChanging(true)
    try {
      await ticketsApi.updateStatus(id, 'resolved', note)
      await ticketsApi.addComment(id, `Resolved: ${note}`, false)
      toast.success('Ticket resolved')
      load()
    } catch { toast.error('Failed to resolve ticket') }
    finally { setStatusChanging(false) }
  }

  const handleEscalate = async () => {
    try {
      await ticketsApi.escalate(id, 'Manually escalated')
      toast.success('Ticket escalated')
      load()
    } catch { toast.error('Failed to escalate') }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied'))
  }

  // Pre-fills the compose textarea with "@Name " and places the cursor
  // right after it, so the agent/employee can just start typing their
  // reply — see handleComment above for how this "@Name" prefix is
  // actually used when the comment is submitted.
  const handleReply = (name: string, commentId: string) => {
    setReplyTo({ name, id: commentId })
    setComment(`@${name} `)
    const ta = document.getElementById('comment-input')
    if (ta) { ta.focus(); (ta as HTMLTextAreaElement).setSelectionRange(name.length + 2, name.length + 2) }
  }

  if (loading) return (
    <DashboardLayout title="Loading…">
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    </DashboardLayout>
  )

  if (!ticket) return (
    <DashboardLayout title="Not Found">
      <div className="text-center py-20 text-gray-500">Ticket not found</div>
    </DashboardLayout>
  )

  const ai = ticket.ai || {}
  // Splits the thread into two separate lists for the Thread/Internal
  // Notes tabs — is_internal is the only thing distinguishing them;
  // both live in the same `comments` array from the API.
  const publicComments   = (ticket.comments || []).filter((c: any) => !c.is_internal)
  const internalComments = (ticket.comments || []).filter((c: any) => c.is_internal)

  return (
    <DashboardLayout title={`Ticket ${ticket.ticket_number}`} subtitle={ticket.department?.name}>
      <div className="max-w-4xl space-y-4">

        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Header card */}
        <div className="glass-card rounded-xl p-6 border border-gray-800/60">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="font-mono text-xs text-gray-500">{ticket.ticket_number}</span>
                {ticket.is_escalated && (
                  <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                    <AlertTriangle className="w-3 h-3" /> Escalated
                  </span>
                )}
                {isResolved && (
                  <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" /> Resolved
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-white">{ticket.title}</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {ticket.department && <DepartmentBadge name={ticket.department.name} color={ticket.department.color} />}
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </div>
          </div>

          <div className="bg-gray-900/60 rounded-lg p-4 mb-4">
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {ticket.resolution_note && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 mb-4">
              <p className="text-xs font-semibold text-green-400 mb-1 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> Resolution Note
              </p>
              <p className="text-sm text-gray-300">{ticket.resolution_note}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {ticket.submitter?.full_name}</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {toSAST(ticket.created_at)}
            </span>
            {ticket.sla_deadline && (
              <span className={clsx('flex items-center gap-1', ticket.sla_breached ? 'text-red-400' : 'text-gray-500')}>
                <Shield className="w-3.5 h-3.5" /> SLA: {toSAST(ticket.sla_deadline)}
                {ticket.sla_breached && ' — BREACHED'}
              </span>
            )}
            {ticket.resolved_at && (
              <span className="flex items-center gap-1 text-green-400">
                <CheckCircle className="w-3.5 h-3.5" /> Resolved {toSAST(ticket.resolved_at)}
              </span>
            )}
          </div>
        </div>

        <SelfHelpPanel ticketId={id} autoLoad={!isAgentOrAdmin} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* AI Classification */}
          <div className="glass-card rounded-xl p-4 border border-blue-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-semibold text-blue-400">AI Classification</span>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ['Department',  ticket.department?.name],
                ['Category',    ai.category],
                ['Routed to',   ai.routed_to_role?.replace(/_/g, ' ')],
                ['Agent',       ai.routed_to_agent_name],
                ['Sentiment',   ai.sentiment],
                ['Score',       ai.token_match_score ? String(ai.token_match_score) : null],
                ['Confidence',  ai.confidence ? `${Math.round(ai.confidence * 100)}%` : null],
              ].map(([label, val]) => val ? (
                <div key={label as string} className="flex justify-between gap-2">
                  <span className="text-gray-600 flex-shrink-0">{label}</span>
                  <span className="text-gray-300 font-medium capitalize text-right truncate">{val as string}</span>
                </div>
              ) : null)}
            </div>
            {ai.routing_rationale && (
              <p className="mt-3 text-xs text-gray-500 italic border-t border-gray-800/60 pt-2 leading-relaxed">{ai.routing_rationale}</p>
            )}
            {ai.skill_tokens?.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-800/60">
                <p className="text-xs text-gray-600 mb-1.5">Matched tokens</p>
                <div className="flex flex-wrap gap-1">
                  {ai.skill_tokens.slice(0, 6).map((t: string) => (
                    <span key={t} className="text-xs bg-blue-500/10 text-blue-400/80 px-1.5 py-0.5 rounded font-mono">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Assignment */}
          <div className="glass-card rounded-xl p-4 border border-gray-800/60">
            <p className="text-xs font-semibold text-gray-400 mb-3">Assignment</p>
            {ticket.assigned_agent ? (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold text-lg">
                  {ticket.assigned_agent.full_name?.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{ticket.assigned_agent.full_name}</p>
                  <p className="text-xs text-gray-500 capitalize">{(ticket.assigned_agent.agent_role_key || '').replace(/_/g, ' ')}</p>
                  {/* Reflects the REAL current selected_by value (see
                      ai_classification.selected_by, updated by both
                      ticket creation and PATCH /assign on the backend)
                      rather than always claiming "AI Assigned" — once
                      an admin manually reassigns a ticket,
                      selected_by becomes "manual_override" and this
                      badge correctly switches to crediting the human
                      instead of the AI. */}
                  {ai.selected_by === 'manual_override' ? (
                    <span className="text-xs text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded mt-1 inline-block">Manually Assigned</span>
                  ) : (
                    <span className="text-xs text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded mt-1 inline-block">AI Assigned</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600">Unassigned</p>
            )}

            {/* Submitter details */}
            {ticket.submitter && (
              <div className="mt-4 pt-4 border-t border-gray-800/40">
                <p className="text-xs font-semibold text-gray-400 mb-2">Submitted by</p>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold text-sm">
                    {ticket.submitter.full_name?.charAt(0)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">{ticket.submitter.full_name}</p>
                    <p className="text-xs text-gray-500">{ticket.submitter.email}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Agent actions */}
          {isAgentOrAdmin && (
            <div className="glass-card rounded-xl p-4 border border-gray-800/60 space-y-2">
              <p className="text-xs font-semibold text-gray-400 mb-3">Update Status</p>

              <div className="relative">
                <label htmlFor="ticket-status" className="sr-only">Update ticket status</label>
                <select
                  id="ticket-status"
                  value={ticket.status}
                  onChange={e => handleStatusChange(e.target.value)}
                  disabled={statusChanging || isResolved}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none pr-8 disabled:opacity-50">
                  {STATUS_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              </div>

              {!isResolved && (
                <button onClick={() => setShowResolve(true)}
                  className="w-full flex items-center justify-center gap-1.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 rounded-lg px-3 py-2 text-xs font-medium transition">
                  <CheckCircle className="w-3.5 h-3.5" /> Mark Resolved
                </button>
              )}

              {!ticket.is_escalated && !isResolved && (
                <button onClick={handleEscalate}
                  className="w-full flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs font-medium transition">
                  <AlertTriangle className="w-3.5 h-3.5" /> Escalate
                </button>
              )}

              {isResolved && (
                <button onClick={() => handleStatusChange('open')}
                  className="w-full flex items-center justify-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-lg px-3 py-2 text-xs font-medium transition">
                  <RefreshCw className="w-3.5 h-3.5" /> Reopen Ticket
                </button>
              )}

              {statusChanging && (
                <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                  <div className="w-3 h-3 border-2 border-gray-500/30 border-t-gray-400 rounded-full animate-spin" />
                  Updating…
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Thread ──────────────────────────────────────────────── */}
        <div className="glass-card rounded-xl border border-gray-800/60 overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center border-b border-gray-800/60 bg-gray-900/40 px-2">
            <button
              onClick={() => setActiveTab('thread')}
              className={clsx('flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition',
                activeTab === 'thread'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300')}>
              <MessageSquare className="w-3.5 h-3.5" />
              Thread
              <span className="bg-gray-800 text-gray-400 rounded-full px-1.5 py-0.5 text-xs">
                {publicComments.length}
              </span>
            </button>
            {isAgentOrAdmin && (
              <button
                onClick={() => setActiveTab('activity')}
                className={clsx('flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition',
                  activeTab === 'activity'
                    ? 'border-yellow-500 text-yellow-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300')}>
                <Lock className="w-3.5 h-3.5" />
                Internal Notes
                <span className="bg-gray-800 text-gray-400 rounded-full px-1.5 py-0.5 text-xs">
                  {internalComments.length}
                </span>
              </button>
            )}
            {isAgentOrAdmin && (
              <span className="ml-auto flex items-center gap-1 text-xs text-blue-400/70 pr-4">
                <Sparkles className="w-3 h-3" /> AI responses enabled
              </span>
            )}
          </div>

          {/* Comment list */}
          <div className="divide-y divide-gray-800/40 max-h-[480px] overflow-y-auto">
            {(activeTab === 'thread' ? publicComments : internalComments).length === 0 ? (
              <div className="px-5 py-10 text-center">
                <MessageSquare className="w-6 h-6 text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-gray-600">
                  {activeTab === 'thread' ? 'No messages yet — be the first to reply' : 'No internal notes yet'}
                </p>
              </div>
            ) : (
              (activeTab === 'thread' ? publicComments : internalComments).map((c: any) => (
                <CommentCard
                  key={c.id}
                  c={c}
                  onReply={handleReply}
                  onCopy={handleCopy}
                  currentUserName={user?.full_name}
                />
              ))
            )}
          </div>

          {/* Compose area */}
          <form onSubmit={handleComment} className="p-5 border-t border-gray-800/60 space-y-3 bg-gray-900/20">
            {isAgentOrAdmin && (
              <AutoResponsePanel
                ticketId={id}
                category={ai.category}
                priority={ticket.priority}
                onInsert={(text) => setComment(text)}
              />
            )}

            {/* Reply-to banner */}
            <AnimatePresence>
              {replyTo && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                  <CornerDownRight className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-blue-400">Replying to <strong>{replyTo.name}</strong></span>
                  <button type="button" onClick={() => { setReplyTo(null); setComment('') }}
                    aria-label="Cancel reply"
                    className="ml-auto text-gray-500 hover:text-gray-300">
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Public / Internal toggle */}
            {isAgentOrAdmin && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setIsInternal(false)}
                  className={clsx('flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition',
                    !isInternal ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'text-gray-500 border-gray-700 hover:border-gray-600')}>
                  <Globe className="w-3 h-3" /> Public Reply
                </button>
                <button type="button" onClick={() => setIsInternal(true)}
                  className={clsx('flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition',
                    isInternal ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'text-gray-500 border-gray-700 hover:border-gray-600')}>
                  <Lock className="w-3 h-3" /> Internal Note
                </button>
              </div>
            )}

            {/* Employee mention hint */}
            {!isAgentOrAdmin && (
              <p className="text-xs text-gray-600 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> Tip: type @name to mention a colleague in your reply
              </p>
            )}

            <div className="relative">
              <textarea
                id="comment-input"
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder={
                  isInternal
                    ? 'Internal note — visible to agents and admins only…'
                    : replyTo
                    ? `Reply to ${replyTo.name}…`
                    : 'Write a reply visible to all parties…'
                }
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition resize-none pr-12"
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-600">
                {comment.length > 0 && `${comment.length} characters`}
              </p>
              <button type="submit" disabled={posting || !comment.trim()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-medium transition">
                <Send className="w-3.5 h-3.5" />
                {posting ? 'Sending…' : isInternal ? 'Add Note' : 'Send Reply'}
              </button>
            </div>
          </form>
        </div>

      </div>

      <AnimatePresence>
        {showResolve && (
          <ResolveModal onConfirm={handleResolve} onClose={() => setShowResolve(false)} />
        )}
      </AnimatePresence>
    </DashboardLayout>
  )
}