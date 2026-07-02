/**
 * TicketIQ — Ticket Badge Components
 * =====================================
 * Three small pill-shaped badges used throughout the ticket list and
 * detail views: PriorityBadge, StatusBadge, and DepartmentBadge. Each
 * one maps a raw backend value (e.g. "critical", "in_progress") to a
 * specific colour/style via the lookup tables below.
 */
import clsx from 'clsx'

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium:   'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low:      'bg-green-500/20 text-green-400 border border-green-500/30',
}

const STATUS_STYLES: Record<string, string> = {
  open:             'bg-blue-500/20 text-blue-400',
  pending:          'bg-yellow-500/20 text-yellow-400',
  assigned:         'bg-cyan-500/20 text-cyan-400',
  in_progress:      'bg-purple-500/20 text-purple-400',
  escalated:        'bg-red-500/20 text-red-400',
  waiting_for_user: 'bg-gray-500/20 text-gray-400',
  resolved:         'bg-green-500/20 text-green-400',
  closed:           'bg-gray-600/20 text-gray-500',
}

const PRIORITY_DOTS: Record<string, string> = {
  critical: 'bg-red-400 animate-pulse',  // critical tickets get a pulsing dot to draw the eye
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-green-400',
}

// Maps each department's hex colour (stored in the database, see
// Department.color in models.py) to a Tailwind background class.
//
// WHY THIS LOOKUP EXISTS rather than just using an inline style: this
// project doesn't run Tailwind's JIT compiler against runtime values,
// so a dynamically-built class string like `bg-[${color}]` only works
// if that exact class string already appears somewhere in the
// project's source for Tailwind's build step to pick up — it can't
// generate arbitrary new classes from a variable at runtime. Hence each
// of the four department colours actually in use gets its exact class
// spelled out here ahead of time.
//
// CAVEAT: any department colour NOT in this exact list (case-insensitive
// hex match) silently falls back to plain grey ('bg-slate-400'/'bg-slate-500')
// rather than rendering its real colour. If a new department is ever
// created through the admin UI with a custom colour outside this set,
// its badge will just look grey — this map needs a new entry added
// for any genuinely new department colour to display correctly.
const DOT_BG_CLASSES: Record<string, string> = {
  '#8b5cf6': 'bg-[#8B5CF6]',  // purple — Human Resources
  '#3b82f6': 'bg-[#3B82F6]',  // blue — Information Technology
  '#10b981': 'bg-[#10B981]',  // green — Finance
  '#f59e0b': 'bg-[#F59E0B]',  // amber — Operations
  '#6b7280': 'bg-slate-500',  // grey — fallback/no department
}

/** Priority pill (critical/high/medium/low) with a coloured dot and uppercase label. */
export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full',
      PRIORITY_STYLES[priority] || PRIORITY_STYLES.low
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', PRIORITY_DOTS[priority] || 'bg-gray-400')} />
      {priority?.toUpperCase()}
    </span>
  )
}

/** Status pill (open/assigned/in_progress/etc) with underscores replaced by spaces for display. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full',
      STATUS_STYLES[status] || STATUS_STYLES.open
    )}>
      {status?.replace(/_/g, ' ').toUpperCase()}
    </span>
  )
}

/** Department pill showing the department's name with its accent colour as a small dot — see DOT_BG_CLASSES above for the colour-mapping caveat. */
export function DepartmentBadge({ name, color = '#3B82F6' }: { name: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-800 text-gray-300">
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', DOT_BG_CLASSES[color.toLowerCase()] || 'bg-slate-400')} />
      {name}
    </span>
  )
}
