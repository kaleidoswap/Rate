/**
 * Message of anything thrown, including the `cause` ES2022 errors carry —
 * the reason this lives in a leaf util: redux catch-arms use it without
 * pulling the service that first needed it (QVACService).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    return causeMsg && !err.message.includes(causeMsg) ? `${err.message} (${causeMsg})` : err.message;
  }
  return String(err);
}
