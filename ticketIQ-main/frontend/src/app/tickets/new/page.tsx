/**
 * TicketIQ — Submit New Ticket Page
 * =====================================
 * The employee-facing ticket submission form, in two states:
 *   1. The form itself, plus a department guide explaining what kinds
 *      of issues route where (purely informational — submitting
 *      doesn't require picking a department, the AI decides that).
 *   2. After submission: a success screen showing exactly how the AI
 *      classified and routed the ticket (department, agent, confidence,
 *      rationale), immediately followed by the auto-loaded self-help panel.
 */
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/shared/DashboardLayout'
import SelfHelpPanel from '@/components/ui/SelfHelpPanel'
import { ticketsApi } from '@/lib/api'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  Cpu, Send, ChevronRight, AlertCircle,
  Zap, CheckCircle, Info, Lightbulb
} from 'lucide-react'

// Purely informational examples shown in the department guide card —
// submitting a ticket never requires picking one of these; the AI
// classifier decides the actual department/routing (see
// classify_ticket() in groq_service.py). If a new department is ever
// added in core/config.py, it should be added here too so the guide
// stays complete.
const DEPT_INFO = [
  { slug: 'hr',         name: 'Human Resources',        color: '#8B5CF6', icon: '👥', examples: ['Leave requests', 'Payslip queries', 'Policy questions', 'Onboarding help'] },
  { slug: 'it',         name: 'Information Technology', color: '#3B82F6', icon: '💻', examples: ['Password reset', 'VPN access', 'Hardware issues', 'Software installs'] },
  { slug: 'finance',    name: 'Finance',                color: '#10B981', icon: '💰', examples: ['Expense claims', 'Payroll queries', 'Purchase orders', 'Budget approvals'] },
  { slug: 'operations', name: 'Operations',             color: '#F59E0B', icon: '🏢', examples: ['Facilities issues', 'Office supplies', 'Travel bookings', 'Building access'] },
]

export default function NewTicketPage() {
  const router = useRouter()
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [result,      setResult]      = useState<any>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) return
    setLoading(true)
    try {
      const { data } = await ticketsApi.create({ title, description })
      setResult(data)
      setSubmitted(true)
      toast.success('Ticket submitted — AI is generating self-help steps!')
    } catch (err: any) {
      // The backend returns a 422 with {rejected: true, reason: "..."}
      // for non-AI-related failures, but note: ticketsApi.create()
      // doesn't currently have special handling for that shape — this
      // generic err.response?.data?.detail fallback only covers
      // standard FastAPI error responses. (Submission failures here
      // are about the REQUEST itself, not photo/image rejection —
      // this app has no photo upload step, unlike PatchIt-style tools.)
      toast.error(err.response?.data?.detail || 'Failed to submit ticket')
    } finally {
      setLoading(false)
    }
  }

  const ai   = result?.ai
  const dept = DEPT_INFO.find(d => d.slug === result?.department?.slug)

  // ── Success screen ──────────────────────────────────────────────────────────
  if (submitted && result) {
    return (
      <DashboardLayout title="Ticket Submitted" subtitle="AI has routed your request and is preparing self-help steps">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-2xl mx-auto space-y-4"
        >
          {/* Success card */}
          <div className="glass-card rounded-xl p-5 border border-green-500/20">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-white font-semibold">Ticket Created Successfully</p>
                <p className="text-xs text-gray-500 font-mono">{result.ticket_number}</p>
              </div>
              <span className={`ml-auto text-xs font-medium px-2 py-1 rounded-full capitalize ${
                result.priority === 'critical' ? 'bg-red-500/15 text-red-400' :
                result.priority === 'high'     ? 'bg-orange-500/15 text-orange-400' :
                result.priority === 'medium'   ? 'bg-yellow-500/15 text-yellow-400' :
                                                  'bg-green-500/15 text-green-400'
              }`}>
                {result.priority} priority
              </span>
            </div>
            <h2 className="text-base font-bold text-white">{result.title}</h2>
          </div>

          {/* AI Routing result */}
          <div className="glass-card rounded-xl p-5 border border-blue-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-blue-400">AI Routing Result</span>
              {ai?.confidence && (
                <span className="ml-auto text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">
                  {Math.round((ai.confidence || 0) * 100)}% confidence
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900/60 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Routed to</p>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{dept?.icon || '🏢'}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{result.department?.name || '—'}</p>
                    <p className="text-xs text-gray-500">{ai?.category || 'General Support'}</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/60 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Assigned Agent</p>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 text-sm font-bold flex-shrink-0">
                    {result.assigned_agent?.full_name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{result.assigned_agent?.full_name || 'Being assigned...'}</p>
                    <p className="text-xs text-gray-500 capitalize">{(result.assigned_agent?.agent_role_key || '').replace(/_/g, ' ')}</p>
                  </div>
                </div>
              </div>
            </div>

            {ai?.routing_rationale && (
              <div className="mt-3 bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                <p className="text-xs text-gray-400 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                  {ai.routing_rationale}
                </p>
              </div>
            )}
          </div>

          {/* ── Self-Help Panel — auto-loads immediately ────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Lightbulb className="w-4 h-4 text-amber-400" />
              <p className="text-sm font-semibold text-amber-300">
                Things to try while your ticket is being reviewed
              </p>
            </div>
            <SelfHelpPanel ticketId={result.id} autoLoad={true} />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/tickets/${result.id}`)}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 text-sm font-medium transition"
            >
              View Full Ticket <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setSubmitted(false); setTitle(''); setDescription(''); setResult(null) }}
              className="flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl px-5 py-3 text-sm font-medium transition"
            >
              New Ticket
            </button>
          </div>

        </motion.div>
      </DashboardLayout>
    )
  }

  // ── Submission form ─────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="Submit a Ticket" subtitle="AI will classify, route, and generate self-help steps instantly">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Department guide */}
        <div className="glass-card rounded-xl p-5 border border-gray-800/60">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-gray-300">AI automatically routes to the correct department & agent</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {DEPT_INFO.map(d => (
              <div key={d.slug} className="rounded-lg bg-gray-900/60 p-3 border border-gray-800/40">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">{d.icon}</span>
                  <span className="text-xs font-semibold" style={{ color: d.color }}>{d.name}</span>
                </div>
                {d.examples.map(ex => (
                  <p key={ex} className="text-xs text-gray-600">· {ex}</p>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* What happens after */}
        <div className="glass-card rounded-xl p-4 border border-amber-500/20 flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-300">After you submit</p>
            <p className="text-xs text-gray-500 mt-0.5">
              AI instantly routes your ticket to the best agent AND generates personalised self-help
              steps you can try right now — so you&apos;re not stuck waiting with nothing to do.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-card rounded-xl p-6 border border-gray-800/60 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Subject <span className="text-red-400">*</span>
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="e.g. Cannot connect to VPN from home"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              rows={6}
              placeholder="Describe your issue in detail. Include error messages, when it started, and what you've already tried. More detail = better self-help steps."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none"
            />
            <p className="text-xs text-gray-600 mt-1">{description.length} chars · More detail = better AI self-help steps</p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading || !title.trim() || !description.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg px-6 py-3 font-medium text-sm transition"
            >
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> AI is routing...</>
                : <><Send className="w-4 h-4" /> Submit Ticket</>
              }
            </button>
            <p className="text-xs text-gray-600 flex items-center gap-1">
              {/* NOTE: deliberately generic rather than naming a
                  specific AI provider/model — this text renders before
                  submission, so there's no way to know yet whether
                  this deployment actually has a real AI key configured
                  or will fall back to the keyword-based classifier
                  (see classify_ticket()'s settings.GROQ_API_KEY check
                  in groq_service.py). Naming a specific provider here
                  unconditionally would be misleading on a deployment
                  running without GROQ_API_KEY set. */}
              <Zap className="w-3 h-3 text-blue-500" /> AI-powered classification & routing
            </p>
          </div>
        </form>

      </div>
    </DashboardLayout>
  )
}
