export type StartupResults = Iterable<[string, { success: boolean; error?: string }]>

const ACCOUNT_NAMES: Record<string, string> = {
  RGB_LN: 'your RGB Lightning node', RGB_L1: 'RGB on this phone', SPARK: 'Spark', ARKADE: 'Arkade', BARK: 'Bark',
}

/** Accounts whose startup failed (an expected `skipped:` state is not a failure). */
export function failedAccounts(results: StartupResults): string[] {
  return Array.from(results).filter(([, r]) => !r.success && !r.error?.startsWith('skipped:')).map(([p]) => p)
}

/**
 * Names of the failed accounts that are still not connected: an account that
 * connected after startup (from Settings, a retry or a network switch) is not offline.
 */
export function offlineAccountNames(failed: string[], isConnected: (protocol: string) => boolean): string[] {
  return failed.filter((p) => !isConnected(p)).map((p) => ACCOUNT_NAMES[p] ?? p)
}
