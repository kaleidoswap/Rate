/**
 * Native calls reject with a stable code: `ERR_RGB_<NAME>` for rgb-lib's own
 * errors (`WalletDirAlreadyExists` → `ERR_RGB_WALLET_DIR_ALREADY_EXISTS`), and
 * a message that starts with rgb-lib's error name. The bridge's own codes:
 */
export const BRIDGE_ERROR_CODES = {
  invalidArgument: 'ERR_RGB_INVALID_ARGUMENT',
  walletNotFound: 'ERR_RGB_WALLET_NOT_FOUND',
  notOnline: 'ERR_RGB_NOT_ONLINE',
  native: 'ERR_RGB_NATIVE',
  unavailable: 'ERR_RGB_UNAVAILABLE',
} as const

export class RgbLibError extends Error {
  /** Stable code, e.g. ERR_RGB_INSUFFICIENT_BITCOINS. */
  readonly code: string
  /** rgb-lib's error name, e.g. InsufficientBitcoins (null for the bridge's own errors). */
  readonly variant: string | null

  constructor(code: string, message: string, variant: string | null = null) {
    super(message)
    this.name = 'RgbLibError'
    this.code = code
    this.variant = variant
  }
}

/** `InsufficientBitcoins` → `ERR_RGB_INSUFFICIENT_BITCOINS` (what the native side sends). */
export function rgbErrorCode(variant: string): string {
  return `ERR_RGB_${variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`
}

const bridgeCodes = new Set<string>(Object.values(BRIDGE_ERROR_CODES))

/** Any error from the native module as an RgbLibError (already one: unchanged). */
export function toRgbLibError(e: unknown): RgbLibError {
  if (e instanceof RgbLibError) return e
  const err = e as { code?: unknown; message?: unknown } | null
  const message = typeof err?.message === 'string' ? err.message : String(e)
  const code = typeof err?.code === 'string' && err.code.startsWith('ERR_RGB_') ? err.code : BRIDGE_ERROR_CODES.native
  let variant: string | null = null
  if (!bridgeCodes.has(code)) {
    const name = /^([A-Za-z0-9]+)/.exec(message)?.[1] ?? null
    variant = name && rgbErrorCode(name) === code ? name : null
  }
  return new RgbLibError(code, message, variant)
}

/** Whether `e` is rgb-lib's error `variant` (e.g. 'WalletDirAlreadyExists'). */
export function isRgbLibError(e: unknown, variant: string): boolean {
  const err = toRgbLibError(e)
  return err.variant === variant || err.code === rgbErrorCode(variant)
}
