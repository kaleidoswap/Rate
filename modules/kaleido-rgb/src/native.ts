import { requireOptionalNativeModule } from 'expo'
import type { InvoiceData, Keys, WalletDirState } from './types'

type Args = Record<string, unknown>

/** The native module (android/…/KaleidoRgbModule.kt, ios/KaleidoRgbModule.swift). */
export interface KaleidoRgbNative {
  rgbLibVersion(): string
  generateKeys(args: Args): Promise<Keys>
  restoreKeys(args: Args): Promise<Keys>
  decodeInvoice(args: Args): Promise<InvoiceData>
  dataDir(args: Args): Promise<string>
  walletDirState(args: Args): Promise<WalletDirState>
  /** The backup's name, or '' when there was no cache to move. */
  moveAsideLegacyBdkCache(args: Args): Promise<string>
  restoreBackup(args: Args): Promise<void>
  openWallet(args: Args): Promise<number>
  closeWallet(handle: number): Promise<void>
  /** Every wallet call: `(handle, args)`, run in order on that wallet's own thread. */
  [walletCall: string]: unknown
}

let cached: KaleidoRgbNative | null | undefined

/** The native module, or null on a build without it. */
export function getNativeModule(): KaleidoRgbNative | null {
  if (cached === undefined) cached = requireOptionalNativeModule<KaleidoRgbNative>('KaleidoRgb')
  return cached
}
