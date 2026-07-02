/**
 * TicketIQ — Root Layout
 * ========================
 * Wraps every page in the app (this is Next.js's App Router root
 * layout — it renders once and persists across navigation, with
 * `children` swapped out for whichever page is currently active).
 *
 * Two responsibilities live here and nowhere else:
 *   1. Global page metadata (browser tab title/description)
 *   2. The single shared <Toaster /> instance from react-hot-toast —
 *      having exactly one Toaster at the root (rather than one per
 *      page) is what lets any component anywhere call toast.success(...)
 *      / toast.error(...) and have it actually render, without each
 *      page needing its own Toaster setup.
 */
import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'TicketIQ Enterprise',
  description: 'AI-Powered Enterprise Smart Ticketing Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: '#1f2937', color: '#f9fafb', border: '1px solid #374151' },
            duration: 4000,
          }}
        />
      </body>
    </html>
  )
}
