/**
 * TicketIQ — API Client
 * =======================
 * A single shared axios instance (`api`) used for every call to the
 * FastAPI backend, plus grouped helper objects (authApi, ticketsApi,
 * analyticsApi, adminApi) that wrap each endpoint in a typed function —
 * components import these rather than calling axios directly, so the
 * actual URL/method for each endpoint only needs to be written once.
 *
 * The two interceptors below are what make authentication mostly
 * invisible to the rest of the app:
 *   - the REQUEST interceptor automatically attaches the current
 *     access token to every outgoing call
 *   - the RESPONSE interceptor automatically refreshes an expired
 *     access token and retries the failed request, rather than making
 *     every single component handle "what if my token expired" itself
 */
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

const api = axios.create({ baseURL: API_URL, withCredentials: false })

// Tracks whether a token refresh is already in flight, and queues up
// any OTHER requests that fail with 401 while that refresh is
// happening — without this, 5 simultaneous API calls failing at once
// (e.g. a dashboard loading 5 widgets in parallel) would each try to
// refresh the token separately, racing each other. Instead, only the
// first one actually calls /auth/refresh; the rest wait in
// `failedQueue` and get resolved together once that one refresh finishes.
let isRefreshing = false
let failedQueue: { resolve: (token: string) => void; reject: (err: any) => void }[] = []

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token!))
  failedQueue = []
}

// REQUEST interceptor: runs before every outgoing API call. Reads the
// access token out of localStorage and attaches it as a Bearer token —
// this is the only place in the whole frontend that needs to know
// about the Authorization header at all.
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// RESPONSE interceptor: runs after every API response. Specifically
// watches for a 401 (token expired/invalid) and, instead of just
// failing, tries to silently refresh the access token and re-send the
// original request — from the calling component's point of view, the
// request just took slightly longer and then succeeded normally.
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config
    if (err.response?.status === 401 && !originalRequest._retry && typeof window !== 'undefined') {
      if (isRefreshing) {
        // A refresh is already happening for a different request —
        // queue this one and wait for that refresh to finish instead
        // of starting a second, redundant refresh call.
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        }).catch(e => Promise.reject(e))
      }
      // _retry flag prevents an infinite loop: if the RETRIED request
      // also comes back 401 (meaning the refresh token itself is no
      // longer valid either), this guard stops it from trying to
      // refresh-and-retry forever.
      originalRequest._retry = true
      isRefreshing = true
      const refresh = localStorage.getItem('refresh_token')
      if (refresh) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, { refresh_token: refresh })
          localStorage.setItem('access_token', data.access_token)
          api.defaults.headers.common.Authorization = `Bearer ${data.access_token}`
          originalRequest.headers.Authorization = `Bearer ${data.access_token}`
          processQueue(null, data.access_token)
          return api(originalRequest)  // retry the original request that triggered all this, now with a fresh token
        } catch (refreshErr) {
          // The refresh token itself is invalid/expired too — there's
          // no way to recover the session, so clear everything and
          // send the user back to the login screen.
          processQueue(refreshErr, null)
          localStorage.clear()
          window.location.href = '/login'
          return Promise.reject(refreshErr)
        } finally {
          isRefreshing = false
        }
      }
    }
    return Promise.reject(err)
  }
)

export default api

// ─── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  login:          (email: string, password: string) => api.post('/auth/login', { email, password }),
  logout:         (refresh_token: string)            => api.post('/auth/logout', { refresh_token }),
  me:             ()                                 => api.get('/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),
}

// ─── Tickets ───────────────────────────────────────────────────────────────
export const ticketsApi = {
  list:         (params?: Record<string, string>) => api.get('/tickets/', { params }),
  get:          (id: string)                       => api.get(`/tickets/${id}`),
  create:       (data: { title: string; description: string }) => api.post('/tickets/', data),
  updateStatus: (id: string, status: string, resolution_note?: string) =>
    api.patch(`/tickets/${id}/status`, { status, resolution_note }),
  assign:       (id: string, agent_id: string)    => api.patch(`/tickets/${id}/assign`, { agent_id }),
  escalate:     (id: string, reason: string)       => api.post(`/tickets/${id}/escalate`, { reason }),
  addComment:   (id: string, content: string, is_internal: boolean) =>
    api.post(`/tickets/${id}/comments`, { content, is_internal }),
  getAiReply:   (id: string)                       => api.get(`/tickets/${id}/ai-reply`),
  // tone: 'formal' | 'friendly' | 'urgent'; trigger describes what prompted the response
  // (new_ticket | agent_reply | resolved | escalated | assigned) — see
  // backend/app/services/ai/response_service.py for how each is used.
  autoResponse: (id: string, tone: string, trigger: string) =>
    api.post(`/tickets/${id}/auto-response`, { tone, trigger }),
  // Same as autoResponse, but generates all 3 tones in one call — used by the tone-picker UI.
  autoResponseAllTones: (id: string, trigger = 'agent_reply') =>
    api.get(`/tickets/${id}/auto-response/all-tones?trigger=${trigger}`),
  selfHelp: (id: string) => api.get(`/tickets/${id}/self-help`),
}

// ─── Analytics ─────────────────────────────────────────────────────────────
export const analyticsApi = {
  overview:         () => api.get('/analytics/overview'),
  byDepartment:     () => api.get('/analytics/by-department'),
  byPriority:       () => api.get('/analytics/by-priority'),
  byStatus:         () => api.get('/analytics/by-status'),
  agentPerformance: () => api.get('/analytics/agent-performance'),
  sla:              () => api.get('/analytics/sla'),
  trends:           () => api.get('/analytics/trends'),
  recentActivity:   () => api.get('/analytics/recent-activity'),
  // Sprint 2 deliverable: written weekly summary insights (see
  // backend/app/services/analytics/weekly_insights.py). The JSON call
  // feeds the dashboard widget; the file download is handled by the
  // separate downloadWeeklyInsightsReport() function below instead of
  // living in this object, since it needs to trigger a browser file
  // save rather than return parsed JSON.
  weeklyInsights:   () => api.get('/analytics/weekly-insights'),
}

/**
 * Downloads the weekly insights report as a .pdf file.
 *
 * This intentionally does NOT go through the shared `api` axios instance
 * above, because that instance is configured to expect JSON responses —
 * here we need the raw response Blob (and the filename the server chose,
 * from the Content-Disposition header) so the browser can save it as an
 * actual file rather than just returning parsed PDF bytes.
 */
export async function downloadWeeklyInsightsReport(): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
  const response = await fetch(`${API_URL}/analytics/weekly-insights/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error('Failed to download weekly insights report.')
  }

  // Pull the server-chosen filename out of the Content-Disposition header
  // (e.g. `attachment; filename="ticketiq-weekly-insights-2026-06-19.txt"`)
  // so the saved file is named the same on the user's machine as it is on
  // the server, instead of falling back to a generic browser-chosen name.
  const disposition = response.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename = match ? match[1] : 'ticketiq-weekly-insights.pdf'

  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

// ─── Sprint 3 — Predictive Forecast ──────────────────────────────────────────
export const forecastApi = {
  /** Returns 7-day ticket volume forecast with MAE/RMSE evaluation. */
  getForecast:  () => api.get('/analytics/forecast'),
  /** Returns plain-English management summary of the 7-day forecast. */
  getInsights:  () => api.get('/analytics/forecast/insights'),
}

// ─── Admin (user + department management, admin-only on the backend) ──────
export const adminApi = {
  listUsers:          ()                        => api.get('/admin/users'),
  createUser:         (data: any)               => api.post('/admin/users', data),
  updateUser:         (id: string, data: any)   => api.patch(`/admin/users/${id}`, data),
  listDepartments:    ()                        => api.get('/admin/departments'),
  createDepartment:   (data: any)               => api.post('/admin/departments', data),
  updateDepartment:   (id: string, data: any)   => api.patch(`/admin/departments/${id}`, data),
  deleteDepartment:   (id: string)              => api.delete(`/admin/departments/${id}`),
  systemStats:        ()                        => api.get('/admin/system-stats'),
}
