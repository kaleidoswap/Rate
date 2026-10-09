/**
 * kaleido-rgb: RGB-Tools' official rgb-lib bindings (rgb-lib-android from Maven
 * Central, rgb-lib-swift's xcframework + generated RgbLib.swift) behind an Expo
 * module. This file is the typed JS side: a `Wallet` with rgb-lib's calls, plus
 * keys, invoices and backup restore. Every native call runs off the JS thread,
 * one at a time per wallet.
 */
import { BRIDGE_ERROR_CODES, RgbLibError, toRgbLibError } from './errors'
import { legacyBdkCacheAction } from './legacy'
import { getNativeModule, type KaleidoRgbNative } from './native'
import type {
  AssetCfa, AssetIfa, AssetNia, AssetSchema, AssetUda, Assets, Assignment, Balance, BitcoinNetwork, BtcBalance,
  InvoiceData, Keys, Metadata, OperationResult, ReceiveData, Recipient, RefreshFilter, RefreshResult, SyncOptions,
  Transaction, Transfer, Unspent, WalletOptions, WitnessVersion,
} from './types'

export * from './types'
export * from './errors'
export { legacyBdkCacheAction } from './legacy'

/** The rgb-lib release this module is built on. */
export const RGB_LIB_VERSION = '0.3.0-beta.7'
/** rgb-lib's old defaults (before expirations became mandatory in 0.3.0-beta.7). */
export const DEFAULT_RECEIVE_SECONDS = 86_400
export const DEFAULT_SEND_SECONDS = 3_600
/** Addresses behind the last used one that a vanilla fast sync looks at. */
export const DEFAULT_VANILLA_SYNC_LOOKBACK = 20
/** What earlier builds opened wallets with (react-native-rgb's defaults). */
export const DEFAULT_SUPPORTED_SCHEMAS: AssetSchema[] = ['CFA', 'NIA', 'UDA']

const SUBDIR = /^[A-Za-z0-9_-]{1,64}$/

/** Unix seconds `durationSeconds` from now; none (or not positive) uses `fallbackSeconds`. */
export function expiresAt(durationSeconds: number | null | undefined, fallbackSeconds: number, nowMs = Date.now()): number {
  const seconds = durationSeconds && durationSeconds > 0 ? durationSeconds : fallbackSeconds
  return Math.floor(nowMs / 1000) + Math.floor(seconds)
}

function native(): KaleidoRgbNative {
  const mod = getNativeModule()
  if (!mod) throw new RgbLibError(BRIDGE_ERROR_CODES.unavailable, 'This app build does not include rgb-lib.')
  return mod
}

async function call<T>(run: (mod: KaleidoRgbNative) => Promise<T>): Promise<T> {
  try {
    return await run(native())
  } catch (e) {
    throw toRgbLibError(e)
  }
}

function checkSubdir(subdir: string | null | undefined): string | null {
  if (subdir == null || subdir === '') return null
  if (!SUBDIR.test(subdir)) throw new RgbLibError(BRIDGE_ERROR_CODES.invalidArgument, `Invalid RGB data folder: ${subdir}`)
  return subdir
}

/** Whether this build has the native module. */
export function isAvailable(): boolean {
  return getNativeModule() !== null
}

/** The rgb-lib version of the native build, or null without one. */
export function nativeRgbLibVersion(): string | null {
  return getNativeModule()?.rgbLibVersion() ?? null
}

/** Wallets in folders of their own (`subdir`): always, with this module. */
export const supportsSubdir = isAvailable
/** Custom signets (Mutinynet): always, with this module. */
export const supportsSignetCustom = isAvailable

export function generateKeys(network: BitcoinNetwork, witnessVersion: WitnessVersion = 'TAPROOT'): Promise<Keys> {
  return call((m) => m.generateKeys({ network, witnessVersion }))
}

/** Taproot by default: the only kind rgb-lib made before 0.3.0-beta.6, so existing wallets keep their keys. */
export function restoreKeys(network: BitcoinNetwork, mnemonic: string, witnessVersion: WitnessVersion = 'TAPROOT'): Promise<Keys> {
  return call((m) => m.restoreKeys({ network, mnemonic, witnessVersion }))
}

/** Restores rgb-lib's encrypted backup into the data folder (or `subdir` inside it). */
export function restoreBackup(backupPath: string, password: string, subdir?: string | null): Promise<void> {
  const folder = checkSubdir(subdir)
  return call((m) => m.restoreBackup({ backupPath, password, subdir: folder }))
}

export function decodeInvoice(invoice: string): Promise<InvoiceData> {
  return call((m) => m.decodeInvoice({ invoice }))
}

/** The absolute folder wallets open in (`subdir` inside the module's data folder). */
export function dataDir(subdir?: string | null): Promise<string> {
  const folder = checkSubdir(subdir)
  return call((m) => m.dataDir({ subdir: folder }))
}

/** One rgb-lib wallet. Opens on first use; `close()` releases it. */
export class Wallet {
  private handle: number | null = null
  private opening: Promise<number> | null = null
  private readonly subdir: string | null
  /** Set when this open moved an old (pre-BDK 3) cache aside: its backup's name. */
  migratedLegacyBdkCache: string | null = null

  constructor(private readonly keys: Keys, private readonly options: WalletOptions) {
    this.subdir = checkSubdir(options.subdir)
  }

  private open(): Promise<number> {
    if (this.handle !== null) return Promise.resolve(this.handle)
    if (!this.opening) {
      this.opening = call(async (m) => {
        const where = { subdir: this.subdir, masterFingerprint: this.keys.masterFingerprint }
        if (legacyBdkCacheAction(await m.walletDirState(where)) === 'move-aside') {
          this.migratedLegacyBdkCache = (await m.moveAsideLegacyBdkCache(where)) || null
        }
        const handle = await m.openWallet({
          network: this.options.network,
          subdir: this.subdir,
          maxAllocationsPerUtxo: this.options.maxAllocationsPerUtxo ?? 1,
          supportedSchemas: this.options.supportedSchemas ?? DEFAULT_SUPPORTED_SCHEMAS,
          keys: {
            accountXpubVanilla: this.keys.accountXpubVanilla,
            accountXpubColored: this.keys.accountXpubColored,
            masterFingerprint: this.keys.masterFingerprint,
            mnemonic: this.keys.mnemonic,
            witnessVersion: this.keys.witnessVersion ?? 'TAPROOT',
            vanillaKeychain: this.options.vanillaKeychain ?? 0,
          },
        })
        this.handle = handle
        return handle
      }).finally(() => { this.opening = null })
    }
    return this.opening
  }

  private async op<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const handle = await this.open()
    return call((m) => (m[name] as (h: number, a: Record<string, unknown>) => Promise<T>)(handle, args))
  }

  /**
   * Connects to the indexer. Unless skipped, rgb-lib full-scans both keychains and
   * checks its database against the chain: that also rebuilds a BDK cache moved aside.
   */
  goOnline(indexerUrl: string, skipConsistencyCheck = false, vanillaSyncLookback = DEFAULT_VANILLA_SYNC_LOOKBACK): Promise<void> {
    return this.op('goOnline', { indexerUrl, skipConsistencyCheck, vanillaSyncLookback })
  }

  getBtcBalance(skipSync = false): Promise<BtcBalance> {
    return this.op('getBtcBalance', { skipSync })
  }

  getAddress(): Promise<string> {
    return this.op('getAddress')
  }

  refresh(assetId: string | null = null, filter: RefreshFilter[] = [], skipSync = false): Promise<RefreshResult> {
    return this.op('refresh', { assetId, filter, skipSync })
  }

  /** A fast sync of both keychains, or one keychain with `options`. */
  async sync(options?: SyncOptions): Promise<void> {
    if (options) return this.op('sync', options as unknown as Record<string, unknown>)
    await this.op('sync', { keychain: 'COLORED', strategy: 'FAST_SYNC' })
    await this.op('sync', { keychain: 'VANILLA', strategy: 'FAST_SYNC', lookback: DEFAULT_VANILLA_SYNC_LOOKBACK })
  }

  /** All schemas when `schemas` is empty. */
  listAssets(schemas: AssetSchema[] = []): Promise<Assets> {
    return this.op('listAssets', { schemas })
  }

  getAssetBalance(assetId: string): Promise<Balance> {
    return this.op('getAssetBalance', { assetId })
  }

  getAssetMetadata(assetId: string): Promise<Metadata> {
    return this.op('getAssetMetadata', { assetId })
  }

  /** Where rgb-lib keeps asset media (CFA/UDA files, by digest). */
  getMediaDir(): Promise<string> {
    return this.op('getMediaDir')
  }

  getWalletDir(): Promise<string> {
    return this.op('getWalletDir')
  }

  /** An invoice for a blinded UTXO; expires `durationSeconds` from now (default a day). */
  blindReceive(assetId: string | null, assignment: Assignment, durationSeconds: number | null, transportEndpoints: string[], minConfirmations: number): Promise<ReceiveData> {
    return this.op('blindReceive', { assetId, assignment, expirationTimestamp: expiresAt(durationSeconds, DEFAULT_RECEIVE_SECONDS), transportEndpoints, minConfirmations })
  }

  /** An invoice whose output the sender creates; expires `durationSeconds` from now (default a day). */
  witnessReceive(assetId: string | null, assignment: Assignment, durationSeconds: number | null, transportEndpoints: string[], minConfirmations: number): Promise<ReceiveData> {
    return this.op('witnessReceive', { assetId, assignment, expirationTimestamp: expiresAt(durationSeconds, DEFAULT_RECEIVE_SECONDS), transportEndpoints, minConfirmations })
  }

  /** Sends assets; the transfer expires (if never acknowledged) at `expirationTimestamp`, default an hour from now. */
  send(recipientMap: Record<string, Recipient[]>, donation: boolean, feeRate: number, minConfirmations: number, expirationTimestamp?: number): Promise<OperationResult> {
    return this.op('send', { recipientMap, donation, feeRate, minConfirmations, expirationTimestamp: expirationTimestamp ?? expiresAt(null, DEFAULT_SEND_SECONDS) })
  }

  sendBtc(address: string, amount: number, feeRate: number, skipSync = false): Promise<string> {
    return this.op('sendBtc', { address, amount, feeRate, skipSync })
  }

  /** Sends all bitcoin to `address`; rgb-lib destroys any assets on the spent UTXOs. */
  drainTo(address: string, feeRate: number): Promise<string> {
    return this.op('drainTo', { address, feeRate })
  }

  /** Newest first. */
  listTransactions(skipSync = false): Promise<Transaction[]> {
    return this.op('listTransactions', { skipSync })
  }

  listTransfers(assetId: string | null = null): Promise<Transfer[]> {
    return this.op('listTransfers', { assetId })
  }

  listUnspents(settledOnly = false, skipSync = false): Promise<Unspent[]> {
    return this.op('listUnspents', { settledOnly, skipSync })
  }

  createUtxos(upTo: boolean, num: number | null, size: number | null, feeRate: number, skipSync = false): Promise<number> {
    return this.op('createUtxos', { upTo, num, size, feeRate, skipSync })
  }

  /** Fails pending transfers (one batch, or all eligible with null). True when any failed. */
  failTransfers(batchTransferIdx: number | null, noAssetOnly = false, skipSync = false): Promise<boolean> {
    return this.op('failTransfers', { batchTransferIdx, noAssetOnly, skipSync })
  }

  /** Deletes failed transfers (one batch, or all with null). True when any was deleted. */
  deleteTransfers(batchTransferIdx: number | null, noAssetOnly = false): Promise<boolean> {
    return this.op('deleteTransfers', { batchTransferIdx, noAssetOnly })
  }

  signPsbt(psbt: string): Promise<string> {
    return this.op('signPsbt', { psbt })
  }

  issueAssetNia(ticker: string, name: string, precision: number, amounts: number[]): Promise<AssetNia> {
    return this.op('issueAssetNia', { ticker, name, precision, amounts })
  }

  /** `filePath`: an optional media file attached to the asset. */
  issueAssetCfa(name: string, details: string | null, precision: number, amounts: number[], filePath: string | null = null): Promise<AssetCfa> {
    return this.op('issueAssetCfa', { name, details, precision, amounts, filePath })
  }

  issueAssetUda(ticker: string, name: string, details: string | null, precision: number, mediaFilePath: string | null = null, attachmentsFilePaths: string[] = []): Promise<AssetUda> {
    return this.op('issueAssetUda', { ticker, name, details, precision, mediaFilePath, attachmentsFilePaths })
  }

  /** Needs 'IFA' in the wallet's supportedSchemas; rgb-lib refuses it on mainnet. */
  issueAssetIfa(ticker: string, name: string, precision: number, amounts: number[], inflationAmounts: number[], rejectListUrl: string | null = null): Promise<AssetIfa> {
    return this.op('issueAssetIfa', { ticker, name, precision, amounts, inflationAmounts, rejectListUrl })
  }

  inflate(assetId: string, inflationAmounts: number[], feeRate: number, minConfirmations: number): Promise<OperationResult> {
    return this.op('inflate', { assetId, inflationAmounts, feeRate, minConfirmations })
  }

  burn(assetId: string, amount: number, feeRate: number, minConfirmations: number): Promise<OperationResult> {
    return this.op('burn', { assetId, amount, feeRate, minConfirmations })
  }

  backup(backupPath: string, password: string): Promise<void> {
    return this.op('backup', { backupPath, password })
  }

  /** True when the wallet changed since its last backup. */
  backupInfo(): Promise<boolean> {
    return this.op('backupInfo')
  }

  getFeeEstimation(blocks: number): Promise<number> {
    return this.op('getFeeEstimation', { blocks })
  }

  /** Releases the native wallet; calls already queued finish first. */
  async close(): Promise<void> {
    const handle = this.handle ?? (this.opening ? await this.opening.catch(() => null) : null)
    this.handle = null
    if (handle === null) return
    await call((m) => m.closeWallet(handle))
  }
}
