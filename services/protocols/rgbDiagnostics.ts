/**
 * Diagnostics for RGB on this phone (RGB_L1, rgb-lib)
 * ---------------------------------------------------
 * Release builds strip console.log and nobody reads logcat on a phone, so a
 * connection that failed (or never finished) left the user with nothing to look
 * at. Every step of opening the on-device RGB wallet, and every failure with its
 * rgb-lib code (ERR_RGB_*), is kept here in a small in-memory buffer:
 * Settings › RGB shows the last error and exports the report (see
 * components/RgbOnDeviceSettings.tsx).
 *
 * Never holds secrets: callers pass steps, networks, server hosts and error
 * messages; long identifiers (xpubs, txids, keys) are cut out of the details.
 */

export interface RgbDiagnosticEvent {
  at: string
  stage: string
  detail: string
}

export interface RgbConnectionError {
  at: number
  network: string | null
  /** ERR_RGB_* when rgb-lib (or the bridge) gave one. */
  code: string | null
  message: string
}

const MAX_EVENTS = 200
const events: RgbDiagnosticEvent[] = []
let lastError: RgbConnectionError | null = null
const listeners = new Set<(e: RgbConnectionError | null) => void>()

/** Cuts long identifiers (xpubs, txids, keys, file paths) out of a detail line. */
export function redactRgbDetail(detail: string): string {
  return detail
    .replace(/(?:file:\/\/|\/data\/|\/var\/|\/Users\/|\/private\/)[^\s'",)]+/g, '[path]')
    .replace(/[A-Za-z0-9_+/=-]{40,}/g, '[id]')
    .slice(0, 400)
}

export function recordRgbDiagnostic(stage: string, detail = ''): void {
  events.push({ at: new Date().toISOString(), stage, detail: redactRgbDetail(detail) })
  if (events.length > MAX_EVENTS) events.shift()
  // Visible in logcat / the Xcode console too (warn survives release builds).
  if (/fail|error|timeout|stale/i.test(stage)) console.warn(`[RGB_L1] ${stage}${detail ? `: ${redactRgbDetail(detail)}` : ''}`)
}

/** The stable ERR_RGB_* code of an rgb-lib / bridge error, if any. */
export function rgbErrorCode(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ERR_RGB_') ? code : null
}

/** An error as the user should see it: `ERR_RGB_CODE: message` when rgb-lib gave a code. */
export function describeRgbError(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : String((e as any)?.message ?? e)
  const code = rgbErrorCode(e)
  return code && !message.includes(code) ? `${code}: ${message}` : message
}

/** Records a failed (or timed-out) connection; Settings shows it until the next success. */
export function recordRgbConnectionError(network: string | null, e: unknown): RgbConnectionError {
  const message = describeRgbError(e)
  lastError = { at: Date.now(), network, code: rgbErrorCode(e) ?? (/^(ERR_RGB_[A-Z_]+)/.exec(message)?.[1] ?? null), message }
  recordRgbDiagnostic('connect_failed', `${network ?? 'unknown network'}: ${message}`)
  listeners.forEach((l) => l(lastError))
  return lastError
}

export function clearRgbConnectionError(): void {
  if (!lastError) return
  lastError = null
  listeners.forEach((l) => l(null))
}

export const lastRgbConnectionError = (): RgbConnectionError | null => lastError

export function onRgbConnectionError(listener: (e: RgbConnectionError | null) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function rgbDiagnosticEvents(): RgbDiagnosticEvent[] {
  return events.slice()
}

/** The report Settings › RGB shares: app context plus the recorded steps and errors. */
export function rgbDiagnosticReport(context: Record<string, unknown> = {}): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    ...context,
    lastError: lastError ? { ...lastError, at: new Date(lastError.at).toISOString() } : null,
    events,
  }, null, 2)
}

/** Tests only. */
export function resetRgbDiagnostics(): void {
  events.length = 0
  lastError = null
}
