/**
 * TicketIQ — Auto-Response Generator Panel
 * ===========================================
 * A collapsible panel (used on the ticket detail page) that lets an
 * agent generate an AI-drafted reply in any of 3 tones, preview it,
 * and either copy it or insert it straight into their reply textarea
 * via the `onInsert` callback the parent page provides.
 *
 * Calls ticketsApi.autoResponseAllTones() once per "Generate" click,
 * which gets all 3 tones back from a single backend call (see
 * generate_all_tones() in services/ai/response_service.py) rather than
 * making 3 separate requests — so switching between tone tabs after
 * generating is instant (just switching which already-fetched string
 * is displayed), with no extra network round-trip per tone.
 */
'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cpu, Zap, Copy, CheckCheck, RefreshCw, ChevronDown, Sparkles } from 'lucide-react'
import { ticketsApi } from '@/lib/api'
import toast from 'react-hot-toast'

type Tone = 'formal' | 'friendly' | 'urgent'

// Visual styling for each tone tab — label/description/colour shown in
// the 3-way tone picker once a response has been generated.
const TONE_CONFIG: Record<Tone, { label: string; desc: string; color: string; bg: string; border: string }> = {
  formal: {
    label:  'Formal',
    desc:   'Professional & precise',
    color:  'text-blue-400',
    bg:     'bg-blue-500/10',
    border: 'border-blue-500/40',
  },
  friendly: {
    label:  'Friendly',
    desc:   'Warm & approachable',
    color:  'text-green-400',
    bg:     'bg-green-500/10',
    border: 'border-green-500/40',
  },
  urgent: {
    label:  'Urgent',
    desc:   'Direct & action-focused',
    color:  'text-red-400',
    bg:     'bg-red-500/10',
    border: 'border-red-500/40',
  },
}

// What event/context the generated response is for — passed through
// to the backend's `trigger` parameter, which selects a different
// system prompt context per option (see generate_auto_response() in
// services/ai/response_service.py).
const TRIGGER_OPTIONS = [
  { value: 'agent_reply',  label: 'Agent Reply' },
  { value: 'new_ticket',   label: 'First Response' },
  { value: 'assigned',     label: 'Assignment Notice' },
  { value: 'resolved',     label: 'Resolution Message' },
  { value: 'escalated',    label: 'Escalation Notice' },
]

interface Props {
  ticketId:  string
  onInsert:  (text: string) => void   // called with the chosen tone's text when the agent clicks "Insert into reply"
  category?: string
  priority?: string
}

export default function AutoResponsePanel({ ticketId, onInsert, category, priority }: Props) {
  const [open,      setOpen]      = useState(false)
  const [tone,      setTone]      = useState<Tone>('formal')
  const [trigger,   setTrigger]   = useState('agent_reply')
  const [tones,     setTones]     = useState<Record<Tone, string> | null>(null)  // all 3 generated tones, keyed by tone name; null until "Generate" is clicked
  const [loading,   setLoading]   = useState(false)
  const [copied,    setCopied]    = useState(false)

  const activeText = tones?.[tone] ?? ''

  const generate = async () => {
    setLoading(true)
    try {
      const { data } = await ticketsApi.autoResponseAllTones(ticketId, trigger)
      setTones(data.tones)
    } catch {
      toast.error('Could not generate responses')
    } finally {
      setLoading(false)
    }
  }

  const handleInsert = () => {
    if (!activeText) return
    onInsert(activeText)
    toast.success('Response inserted into reply box')
  }

  const handleCopy = async () => {
    if (!activeText) return
    await navigator.clipboard.writeText(activeText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)  // revert the "Copied" checkmark back to the copy icon after 2s
    toast.success('Copied to clipboard')
  }

  return (
    <div className="border border-gray-800/60 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900/60 hover:bg-gray-900/80 transition"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-500/15 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <span className="text-sm font-medium text-gray-300">AI Response Generator</span>
          {category && (
            <span className="text-xs text-gray-600 hidden sm:inline">· {category}</span>
          )}
          {priority && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium hidden sm:inline ${
              priority === 'critical' ? 'bg-red-500/15 text-red-400' :
              priority === 'high'     ? 'bg-orange-500/15 text-orange-400' :
              priority === 'medium'   ? 'bg-yellow-500/15 text-yellow-400' :
                                        'bg-gray-700 text-gray-400'
            }`}>{priority}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-4 bg-gray-950/40 border-t border-gray-800/40">

              {/* Controls row */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Trigger type */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 whitespace-nowrap">Response type</label>
                  <select
                    value={trigger}
                    onChange={e => { setTrigger(e.target.value); setTones(null) }}
                    className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {TRIGGER_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Generate button */}
                <button
                  onClick={generate}
                  disabled={loading}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
                >
                  {loading
                    ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Generating...</>
                    : <><Zap className="w-3 h-3" /> Generate</>
                  }
                </button>

                {tones && (
                  <button
                    onClick={generate}
                    disabled={loading}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition"
                  >
                    <RefreshCw className="w-3 h-3" /> Regenerate
                  </button>
                )}
              </div>

              {/* Tone selector */}
              {tones && (
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(TONE_CONFIG) as Tone[]).map(t => {
                    const cfg = TONE_CONFIG[t]
                    const active = tone === t
                    return (
                      <button
                        key={t}
                        onClick={() => setTone(t)}
                        className={`text-left p-3 rounded-lg border transition ${
                          active
                            ? `${cfg.bg} ${cfg.border}`
                            : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-700'
                        }`}
                      >
                        <p className={`text-xs font-semibold ${active ? cfg.color : 'text-gray-400'}`}>
                          {cfg.label}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">{cfg.desc}</p>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Preview */}
              {tones && activeText && (
                <motion.div
                  key={tone}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative"
                >
                  <div className={`rounded-lg border p-4 ${TONE_CONFIG[tone].bg} ${TONE_CONFIG[tone].border}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Cpu className={`w-3 h-3 ${TONE_CONFIG[tone].color}`} />
                      <span className={`text-xs font-medium ${TONE_CONFIG[tone].color}`}>
                        AI · {TONE_CONFIG[tone].label} tone
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{activeText}</p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={handleInsert}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
                    >
                      <Zap className="w-3 h-3" /> Insert into reply
                    </button>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition"
                    >
                      {copied
                        ? <><CheckCheck className="w-3 h-3 text-green-400" /> Copied</>
                        : <><Copy className="w-3 h-3" /> Copy</>
                      }
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Empty state */}
              {!tones && !loading && (
                <p className="text-xs text-gray-600 text-center py-2">
                  Click Generate to create AI responses in 3 tones
                </p>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
