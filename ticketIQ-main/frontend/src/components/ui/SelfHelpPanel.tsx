/**
 * TicketIQ — Self-Help Panel
 * =============================
 * A collapsible "try these first" checklist shown on the employee-facing
 * side of a ticket, giving them concrete steps to try themselves while
 * waiting for an agent. Backed by GET /tickets/{id}/self-help (see
 * generate_self_help() in services/ai/response_service.py), which
 * returns either AI-generated or template-matched steps depending on
 * whether GROQ is configured.
 *
 * Each step can be checked off (purely client-side, tracked in the
 * `checked` Set below — nothing is persisted to the backend), so the
 * employee can track their own progress through the list without that
 * state needing to survive a page refresh.
 */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lightbulb, ChevronDown, Clock, AlertTriangle,
  CheckCircle, Circle, Zap, RefreshCw, ExternalLink
} from 'lucide-react'
import { ticketsApi } from '@/lib/api'

// Visual styling for each step's risk level — "none" risk steps show
// no badge at all (see the `step.risk !== 'none'` check further down).
const RISK_CONFIG = {
  none:   { label: 'Safe',    color: 'text-green-400',  bg: 'bg-green-500/10' },
  low:    { label: 'Low risk',color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  medium: { label: 'Caution', color: 'text-orange-400', bg: 'bg-orange-500/10' },
}

interface Step {
  order: number
  title: string
  instruction: string
  time_estimate: string
  risk: 'none' | 'low' | 'medium'
  success_indicator: string
}

interface SelfHelpData {
  can_self_resolve: boolean
  confidence: number
  summary: string
  steps: Step[]
  escalate_if: string
  useful_links: { label: string; url: string | null }[]
  generated_by: string
}

interface Props {
  ticketId: string
  autoLoad?: boolean   // true = load immediately on mount
}

export default function SelfHelpPanel({ ticketId, autoLoad = false }: Props) {
  const [open,      setOpen]      = useState(autoLoad)
  const [data,      setData]      = useState<SelfHelpData | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [checked,   setChecked]   = useState<Set<number>>(new Set())

  // Fetches self-help steps once and caches them in `data` — guarded by
  // `if (data) return` so reopening the panel after it's already
  // loaded doesn't re-fetch; only an explicit "regenerate" click
  // (which clears `data` first) triggers a fresh request.
  const load = useCallback(async () => {
    if (data) return   // already loaded
    setLoading(true)
    try {
      const { data: res } = await ticketsApi.selfHelp(ticketId)
      setData(res)
    } catch {
      // silent — self-help is optional
    } finally {
      setLoading(false)
    }
  }, [data, ticketId])

  // Auto-load on mount if flag set
  useEffect(() => {
    if (autoLoad) load()
  }, [autoLoad, ticketId, load])

  const toggle = () => {
    setOpen(o => !o)
    if (!data && !loading) load()
  }

  // Checks/unchecks a single step — purely local UI state, see the
  // module header above for why this never gets sent to the backend.
  const toggleStep = (order: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(order) ? next.delete(order) : next.add(order)
      return next
    })
  }

  const completedCount = checked.size
  const totalSteps     = data?.steps?.length || 0

  return (
    <div className="border border-amber-500/20 rounded-xl overflow-hidden">

      {/* Header */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-500/5 hover:bg-amber-500/10 transition"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <span className="text-sm font-medium text-amber-300">
            While you wait — try these first
          </span>
          {data && (
            <span className="text-xs text-amber-500/70">
              {completedCount}/{totalSteps} steps done
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && completedCount > 0 && completedCount === totalSteps && (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> All tried
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-amber-500/60 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
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
            <div className="p-4 bg-gray-950/60 border-t border-amber-500/10 space-y-4">

              {/* Loading */}
              {loading && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <div className="w-4 h-4 border-2 border-amber-500/30 border-t-amber-400 rounded-full animate-spin" />
                  <span className="text-sm text-amber-400/70">AI is generating self-help steps...</span>
                </div>
              )}

              {data && (
                <>
                  {/* Summary + confidence */}
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-gray-300 leading-relaxed">{data.summary}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          data.can_self_resolve
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-gray-700 text-gray-400'
                        }`}>
                          {data.can_self_resolve ? '✓ May self-resolve' : 'Agent required'}
                        </span>
                        <span className="text-xs text-gray-600">
                          {Math.round(data.confidence * 100)}% confidence
                        </span>
                        {data.generated_by === 'groq' && (
                          <span className="text-xs text-blue-400/60 flex items-center gap-1">
                            <Zap className="w-2.5 h-2.5" /> AI generated
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { setData(null); setChecked(new Set()); load() }}
                      className="text-gray-600 hover:text-gray-400 transition flex-shrink-0"
                      title="Regenerate"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Progress bar */}
                  {totalSteps > 0 && (
                    <div className="w-full bg-gray-800 rounded-full h-1">
                      <div
                        className="bg-amber-400 h-1 rounded-full transition-all duration-500"
                        style={{ width: `${(completedCount / totalSteps) * 100}%` }}
                      />
                    </div>
                  )}

                  {/* Steps */}
                  <div className="space-y-2">
                    {data.steps.map((step) => {
                      const done    = checked.has(step.order)
                      const riskCfg = RISK_CONFIG[step.risk] || RISK_CONFIG.none
                      return (
                        <motion.div
                          key={step.order}
                          layout
                          className={`rounded-lg border p-3 transition cursor-pointer ${
                            done
                              ? 'bg-green-500/5 border-green-500/20 opacity-60'
                              : 'bg-gray-900/50 border-gray-800/60 hover:border-amber-500/20'
                          }`}
                          onClick={() => toggleStep(step.order)}
                        >
                          <div className="flex items-start gap-3">
                            {/* Checkbox */}
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 transition ${
                              done
                                ? 'bg-green-500 border-green-500'
                                : 'border-gray-600 hover:border-amber-400'
                            }`}>
                              {done
                                ? <CheckCircle className="w-3.5 h-3.5 text-white" />
                                : <span className="text-xs text-gray-500 font-mono">{step.order}</span>
                              }
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm font-medium ${done ? 'line-through text-gray-500' : 'text-white'}`}>
                                  {step.title}
                                </p>
                                <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                                  <span className="flex items-center gap-1 text-xs text-gray-500">
                                    <Clock className="w-3 h-3" /> {step.time_estimate}
                                  </span>
                                  {step.risk !== 'none' && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${riskCfg.bg} ${riskCfg.color}`}>
                                      {riskCfg.label}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                                {step.instruction}
                              </p>

                              {!done && (
                                <p className="text-xs text-green-400/70 mt-1.5 flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  {step.success_indicator}
                                </p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Escalate warning */}
                  {data.escalate_if && (
                    <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-red-400">Skip these steps and escalate if:</p>
                        <p className="text-xs text-gray-400 mt-0.5">{data.escalate_if}</p>
                      </div>
                    </div>
                  )}

                  {/* Useful links */}
                  {data.useful_links?.filter(l => l.url).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-600">Useful resources</p>
                      {data.useful_links.filter(l => l.url).map((link, i) => (
                        <a
                          key={i}
                          href={link.url!}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition"
                        >
                          <ExternalLink className="w-3 h-3" /> {link.label}
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}

              {!data && !loading && (
                <p className="text-xs text-gray-600 text-center py-2">
                  Click the panel header to load AI self-help steps
                </p>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
