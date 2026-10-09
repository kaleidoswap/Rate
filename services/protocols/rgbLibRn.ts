/**
 * rgb-lib on React Native, shaped like the WDK RGB module
 * -------------------------------------------------------
 * The wallet engine's `RgbLibWdkAdapter` (protocol RGB_L1: BTC + RGB assets
 * on-chain, no Lightning) drives a WDK module, `@utexo/wdk-wallet-rgb`, which
 * needs a Node/Bare runtime. On the phone we hand the engine this module
 * instead (see ./wdk.ts, `registerWdkModule`): the same `WalletManagerRgb` /
 * account surface, backed by the native rgb-lib bindings in `react-native-rgb`
 * (rgb-lib-kotlin on Android, rgb-lib-swift on iOS).
 *
 * Only the calls the adapter makes are implemented. rgb-lib keeps its data in
 * the app's private files; the adapter's `dataDir` names a folder inside them
 * for this wallet (see `rgbLibSubdir`), else rgb-lib's original folder.
 */
import type * as RgbLib from 'react-native-rgb'

type RgbModule = typeof RgbLib
type LibNetwork = RgbLib.BitcoinNetwork

export interface RgbLibRnOptions {
  /** App network name: 'mutinynet' and 'signet' map to rgb-lib's SIGNET. */
  network: string
  /** A folder name keeps the wallet in its own folder; anything else ('.') uses the original one. */
  dataDir?: string
  indexerUrl?: string
  transportEndpoint?: string
}

/** rgb-lib's network for an app network name. Mutinynet is a custom signet. */
export function libNetwork(network: string): LibNetwork {
  switch (network) {
    case 'mainnet': return 'MAINNET'
    case 'testnet': return 'TESTNET'
    case 'testnet4': return 'TESTNET4'
    case 'regtest': return 'REGTEST'
    case 'signet':
    case 'mutinynet': return 'SIGNET'
    default: throw new Error(`Unsupported RGB network: ${network}`)
  }
}

/** The folder to open the wallet in, or null for rgb-lib's original folder. */
export function rgbLibSubdir(dataDir?: string | null): string | null {
  return dataDir && /^[A-Za-z0-9_-]{1,64}$/.test(dataDir) ? dataDir : null
}

/** react-native-rgb with the `subdir` support from patches/react-native-rgb@*.patch (typed here so older typings still build). */
type RgbModuleWithSubdir = RgbModule & { supportsSubdir?: () => boolean }
type WalletOptionsWithSubdir = NonNullable<ConstructorParameters<RgbModule['Wallet']>[1]> & { subdir?: string }

// rgb-lib only moves an incoming transfer forward (and syncs the chain) when asked;
// reads refresh at most this often so balances stay current without hammering the indexer.
const REFRESH_EVERY_MS = 30_000
const DEFAULT_FEE_RATE = 2
// The output a sender creates for a witness invoice: rgb-lib's colorable-UTXO size, above dust.
const WITNESS_OUTPUT_SAT = 1000
/** rgb-lib names a witness recipient `wvout:…` and a blinded UTXO `utxob:…`. */
const isWitnessRecipient = (recipientId: string) => /^wvout:/i.test(recipientId)

/**
 * What this native build offers beyond sending and receiving. Each is detected on the
 * wallet object, so a build without one leaves the feature hidden instead of failing.
 */
export interface RgbDeviceCapabilities {
  metadata: boolean
  issueUda: boolean
  /** IFA issuance and inflation; rgb-lib refuses IFA on mainnet. */
  issueIfa: boolean
  inflate: boolean
  drain: boolean
  deleteTransfers: boolean
}

type MaybeWallet = { [K in keyof RgbLib.Wallet]?: unknown }

/** 'RECEIVE_WITNESS' → 'ReceiveWitness', as the RGB node names transfer kinds and statuses. */
function pascal(value: string): string {
  return value.toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase())
}

/** The account the adapter talks to, over one native rgb-lib wallet. */
export class RgbLibRnAccount {
  private lastRefresh = 0
  private refreshing: Promise<boolean> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private udaIds = new Set<string>()

  constructor(
    private readonly lib: RgbModule,
    private readonly wallet: RgbLib.Wallet,
    private readonly transportEndpoint: string,
    /** Called after anything that changes what a backup holds (send, receive, settle). */
    private readonly onChange: () => void = () => undefined,
    /** App network name ('mainnet', 'mutinynet', …). */
    private readonly network: string = '',
  ) {}

  capabilities(): RgbDeviceCapabilities {
    const w = this.wallet as MaybeWallet
    const has = (name: keyof RgbLib.Wallet) => typeof w[name] === 'function'
    const ifa = this.network !== 'mainnet'
    return {
      metadata: has('getAssetMetadata'),
      issueUda: has('issueAssetUda'),
      issueIfa: ifa && has('issueAssetIfa'),
      inflate: ifa && has('inflate'),
      drain: has('drainTo'),
      deleteTransfers: has('deleteTransfers'),
    }
  }

  /**
   * rgb-lib keeps one local database: its calls run one at a time, in the order
   * they were made, whichever screen or background job makes them.
   */
  private serial<T>(call: () => Promise<T>): Promise<T> {
    const run = this.queue.then(call)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Advance pending transfers and sync, at most every REFRESH_EVERY_MS (or now with force). True when a transfer moved. */
  private async refresh(force = false): Promise<boolean> {
    if (this.refreshing) return this.refreshing
    if (!force && Date.now() - this.lastRefresh < REFRESH_EVERY_MS) return false
    this.refreshing = (async () => {
      try {
        const updated = await this.serial(() => this.wallet.refresh(null, [], false))
        this.lastRefresh = Date.now()
        const moved = !!updated && Object.keys(updated).length > 0
        if (moved) this.onChange() // a transfer moved: settle, receive, fail
        return moved
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  /** Advance pending transfers now (Receive and the asset screen poll this). True when one moved. */
  refreshTransfers(): Promise<boolean> {
    return this.refresh(true)
  }

  /** The adapter's readiness probe and BTC balance source: `{ address, btcBalance }`. */
  async registerWallet(): Promise<{ address: string; btcBalance: RgbLib.BtcBalance }> {
    await this.refresh().catch(() => undefined) // a failed sync still leaves the last known balance
    const address = await this.serial(() => this.wallet.getAddress())
    const btcBalance = await this.serial(() => this.wallet.getBtcBalance(true))
    return { address, btcBalance }
  }

  getAddress(): Promise<string> {
    return this.serial(() => this.wallet.getAddress())
  }

  // The adapter calls these without awaiting: never let them reject.
  refreshWallet(): Promise<void> {
    return this.refresh(true).then(() => undefined, (e) => console.warn('[RGB_L1] refresh failed:', e?.message ?? e))
  }

  syncWallet(): Promise<void> {
    return this.serial(() => this.wallet.sync()).catch((e) => console.warn('[RGB_L1] sync failed:', e?.message ?? e))
  }

  /**
   * Every asset under `nia`, the list the adapter reads: NIA and IFA tokens, CFA named
   * by their name, and UDA collectibles (one unit each).
   */
  async listAssets(): Promise<RgbLib.Assets> {
    await this.refresh().catch(() => undefined)
    const assets = await this.serial(() => this.wallet.listAssets(['NIA', 'CFA', 'IFA', 'UDA']))
      .catch(() => this.serial(() => this.wallet.listAssets(['NIA', 'CFA'])))
      .catch(() => this.serial(() => this.wallet.listAssets(['NIA'])))
    const cfa = (assets.cfa ?? []).map((a) => ({ ...a, ticker: a.name }))
    const ifa = (assets.ifa ?? []).map((a) => ({ ...a, issuedSupply: a.knownCirculatingSupply ?? a.initialSupply }))
    const uda = (assets.uda ?? []).map((a) => ({ ...a, issuedSupply: 1 }))
    this.udaIds = new Set(uda.map((a) => a.assetId))
    return { ...assets, nia: [...(assets.nia ?? []), ...cfa, ...ifa, ...uda] as RgbLib.AssetNia[] }
  }

  /**
   * An RGB invoice. No asset id receives any asset (a new one); amount 0 asks for any
   * amount. Witness by default: the sender creates the output, so no colorable UTXO
   * is needed here. Takes the engine's camelCase options and the node's snake_case
   * ones (Receive passes the latter), and answers in both.
   */
  async receiveAsset(params: {
    assetId?: string | null; asset_id?: string | null
    amount?: number
    witness?: boolean
    durationSeconds?: number; duration_seconds?: number
    minConfirmations?: number; min_confirmations?: number
  } = {}) {
    const assetId = params.assetId ?? params.asset_id ?? null
    const assignment: RgbLib.Assignment = params.amount && params.amount > 0
      ? { type: 'FUNGIBLE', amount: params.amount }
      : { type: 'ANY' }
    const receive = params.witness === false ? this.wallet.blindReceive.bind(this.wallet) : this.wallet.witnessReceive.bind(this.wallet)
    const data = await this.serial(() => receive(
      assetId, assignment, params.durationSeconds ?? params.duration_seconds ?? null,
      [this.transportEndpoint], params.minConfirmations ?? params.min_confirmations ?? 1,
    ))
    this.onChange()
    return { ...data, recipient_id: data.recipientId, expiration_timestamp: data.expirationTimestamp }
  }

  /** Send an RGB asset to an invoice (the adapter's `sendAsset`). */
  async transfer(params: {
    token: string
    recipient: string
    amount: number
    feeRate?: number
    minConfirmations?: number
    witnessData?: { amountSat: number; blinding?: number }
  }): Promise<RgbLib.OperationResult> {
    const invoice = await this.lib.decodeInvoice(params.recipient)
    const endpoints = invoice.transportEndpoints?.length ? invoice.transportEndpoints : [this.transportEndpoint]
    // A witness invoice asks the sender to create the receiving output: fund it with
    // rgb-lib's usual colorable-UTXO size unless the caller chose otherwise.
    const witnessData = params.witnessData ?? (isWitnessRecipient(invoice.recipientId) ? { amountSat: WITNESS_OUTPUT_SAT } : undefined)
    // A collectible moves whole: a UDA is sent as its one non-fungible unit.
    const nonFungible = this.udaIds.has(params.token) || invoice.assignment?.type === 'NON_FUNGIBLE'
    const recipient: RgbLib.Recipient = {
      recipientId: invoice.recipientId,
      assignment: nonFungible ? { type: 'NON_FUNGIBLE' } : { type: 'FUNGIBLE', amount: params.amount },
      transportEndpoints: endpoints,
      ...(witnessData ? { witnessData } : {}),
    }
    const result = await this.serial(() => this.wallet.send(
      { [params.token]: [recipient] }, false, params.feeRate ?? DEFAULT_FEE_RATE, params.minConfirmations ?? 1,
    ))
    this.lastRefresh = 0 // the next read picks the transfer up
    this.onChange()
    return result
  }

  /** An RGB invoice decoded on the device, in the RGB node's shape (what Send reads). */
  async decodeRgbInvoice(invoice: string) {
    const d = await this.lib.decodeInvoice(invoice)
    const fungible = d.assignment?.type === 'FUNGIBLE' && d.assignment.amount
    return {
      ...d,
      asset_id: d.assetId,
      recipient_id: d.recipientId,
      transport_endpoints: d.transportEndpoints,
      expiration_timestamp: d.expirationTimestamp,
      assignment: fungible ? { type: 'Fungible', value: d.assignment.amount } : { type: pascal(d.assignment?.type ?? 'ANY') },
    }
  }

  /** Plain BTC on-chain send; resolves to the txid. */
  async sendTransaction(params: { to: string; value: number; feeRate?: number }): Promise<string> {
    const txid = await this.serial(() => this.wallet.sendBtc(params.to, params.value, params.feeRate ?? DEFAULT_FEE_RATE))
    this.onChange()
    return txid
  }

  /** BTC history, with rgb-lib's confirmation time in the shape the adapter reads. */
  async listTransactions() {
    const txs = await this.serial(() => this.wallet.listTransactions(true))
    return txs.map((t) => ({ ...t, confirmation_time: t.confirmationTime ? { timestamp: t.confirmationTime } : undefined }))
  }

  /** Transfers in the node's shape (Activity reads `kind`, `status`, `created_at`, `requested_assignment.value`). */
  async listTransfers(assetId: string | null) {
    const transfers = await this.serial(() => this.wallet.listTransfers(assetId))
    return transfers.map((t) => ({
      ...t,
      kind: pascal(t.kind),
      status: pascal(t.status),
      created_at: t.createdAt,
      updated_at: t.updatedAt,
      requested_assignment: t.requestedAssignment ? { ...t.requestedAssignment, value: t.requestedAssignment.amount } : undefined,
      batch_transfer_idx: t.batchTransferIdx,
      recipient_id: t.recipientId,
      amount: t.assignments?.reduce((sum, a) => sum + (a.amount ?? 0), 0),
    }))
  }

  /**
   * Marks a transfer still waiting for its counterparty as failed, which frees
   * what it reserved (rgb-lib refuses any other). True when it was failed.
   */
  async failTransfer(batchTransferIdx: number): Promise<boolean> {
    const failed = await this.serial(() => this.wallet.failTransfers(batchTransferIdx, false, false))
    this.lastRefresh = 0
    if (failed) this.onChange()
    return failed
  }

  /** Removes a failed transfer from the wallet's history (rgb-lib refuses any other). */
  async deleteTransfer(batchTransferIdx: number): Promise<boolean> {
    const deleted = await this.serial(() => this.wallet.deleteTransfers(batchTransferIdx, false))
    if (deleted) this.onChange()
    return deleted
  }

  /** Removes every failed transfer. True when any was removed. */
  async deleteFailedTransfers(): Promise<boolean> {
    const deleted = await this.serial(() => this.wallet.deleteTransfers(null, false))
    if (deleted) this.onChange()
    return deleted
  }

  /**
   * An asset's contract data, plus its media file (CFA, UDA, IFA) when the wallet holds one.
   * Amounts as rgb-lib reports them: `initialSupply`/`knownCirculatingSupply`/`maxSupply`
   * from newer builds, `issuedSupply` from older typings.
   */
  async getAssetMetadata(assetId: string): Promise<RgbLib.AssetMetadata & { assetSchema?: string; media?: RgbLib.Media }> {
    const metadata = await this.serial(() => this.wallet.getAssetMetadata(assetId))
    const media = await this.assetMedia(assetId).catch(() => undefined)
    return { ...metadata, assetId, ...(media ? { media } : {}) }
  }

  private async assetMedia(assetId: string): Promise<RgbLib.Media | undefined> {
    const assets = await this.serial(() => this.wallet.listAssets(['CFA', 'UDA', 'IFA']))
    const found: any = [...(assets.cfa ?? []), ...(assets.uda ?? []), ...(assets.ifa ?? [])].find((a) => a.assetId === assetId)
    return found?.media ?? found?.token?.media ?? undefined
  }

  /** A Unique Digital Asset (one collectible), optionally with a media file at a local path. */
  async issueAssetUda(params: {
    ticker: string; name: string; details?: string | null; precision?: number
    mediaFilePath?: string | null; attachmentsFilePaths?: string[]
  }): Promise<RgbLib.AssetUda> {
    const asset = await this.serial(() => this.wallet.issueAssetUda(
      params.ticker, params.name, params.details || null, params.precision ?? 0,
      params.mediaFilePath ?? null, params.attachmentsFilePaths ?? [],
    ))
    this.onChange()
    return asset
  }

  /** An Inflatable Fungible Asset: `inflationAmounts` are the rights to issue more later. */
  async issueAssetIfa(params: {
    ticker: string; name: string; precision: number; amounts: number[]
    inflationAmounts: number[]; replaceRightsNum?: number; rejectListUrl?: string | null
  }): Promise<RgbLib.AssetIfa> {
    const asset = await this.serial(() => this.wallet.issueAssetIfa(
      params.ticker, params.name, params.precision, params.amounts,
      params.inflationAmounts, params.replaceRightsNum ?? 0, params.rejectListUrl ?? null,
    ))
    this.onChange()
    return asset
  }

  /** How much more of an IFA asset this wallet may still issue: its unspent inflation rights. */
  async inflationRights(assetId: string): Promise<number> {
    const unspents = await this.serial(() => this.wallet.listUnspents(false, true))
    return unspents.reduce((sum, u) => sum + (u.rgbAllocations ?? [])
      .filter((a) => a.assetId === assetId && a.assignment?.type === 'INFLATION_RIGHT')
      .reduce((s, a) => s + (a.assignment.amount ?? 0), 0), 0)
  }

  /** Issues more of an IFA asset using its inflation rights; broadcasts a transaction. */
  async inflate(params: { assetId: string; inflationAmounts: number[]; feeRate?: number; minConfirmations?: number }): Promise<RgbLib.OperationResult> {
    const result = await this.serial(() => this.wallet.inflate(
      params.assetId, params.inflationAmounts, params.feeRate ?? DEFAULT_FEE_RATE, params.minConfirmations ?? 1,
    ))
    this.lastRefresh = 0
    this.onChange()
    return result
  }

  /**
   * Sends all plain bitcoin to `address`; outputs holding assets stay. rgb-lib up to
   * 0.3.0-beta.5 takes `(address, destroyAssets, feeRate)` and gets false; later builds
   * dropped `destroyAssets` and take `(address, feeRate)`.
   */
  async drainTo(params: { address: string; feeRate?: number }): Promise<string> {
    const feeRate = params.feeRate ?? DEFAULT_FEE_RATE
    const drain = this.wallet.drainTo as unknown as (...args: unknown[]) => Promise<string>
    const txid = await this.serial(() => drain.length === 2
      ? drain.call(this.wallet, params.address, feeRate)
      : drain.call(this.wallet, params.address, false, feeRate))
    this.lastRefresh = 0
    this.onChange()
    return txid
  }

  listUnspents(): Promise<RgbLib.Unspent[]> {
    return this.serial(() => this.wallet.listUnspents(false, true))
  }

  /** Colorable UTXOs for receiving assets; broadcasts a transaction. */
  async createUtxos(params: { num?: number; size?: number; feeRate?: number; upTo?: boolean } = {}): Promise<number> {
    const created = await this.serial(() => this.wallet.createUtxos(params.upTo ?? true, params.num ?? 5, params.size ?? null, params.feeRate ?? DEFAULT_FEE_RATE))
    this.lastRefresh = 0
    this.onChange()
    return created
  }

  signPsbt(psbt: string): Promise<string> {
    return this.serial(() => this.wallet.signPsbt(psbt))
  }

  async issueAssetNia(params: { ticker: string; name: string; precision: number; amounts: number[] }): Promise<RgbLib.AssetNia> {
    const asset = await this.serial(() => this.wallet.issueAssetNia(params.ticker, params.name, params.precision, params.amounts))
    this.onChange()
    return asset
  }

  /** A Collectible Fungible Asset: a name and optional details, no ticker. */
  async issueAssetCfa(params: { name: string; details?: string | null; precision: number; amounts: number[]; filePath?: string | null }): Promise<RgbLib.AssetCfa> {
    const asset = await this.serial(() => this.wallet.issueAssetCfa(params.name, params.details || null, params.precision, params.amounts, params.filePath ?? null))
    this.onChange()
    return asset
  }

  /** Encrypted backup of everything the seed can't rebuild (RGB state, consignments). */
  backup(path: string, password: string): Promise<void> {
    return this.serial(() => this.wallet.backup(path, password))
  }

  /** True when the wallet changed since its last backup. */
  backupRequired(): Promise<boolean> {
    return this.serial(() => this.wallet.backupInfo())
  }

  dispose(): Promise<void> {
    return this.serial(() => this.wallet.close())
  }
}

/**
 * Builds the module the engine's `loadWdkModule('@utexo/wdk-wallet-rgb')` returns.
 * `load` is a lazy `require('react-native-rgb')`, so the native module is touched
 * only when the RGB account connects.
 */
export function createRgbLibRnModule(load: () => RgbModule, hooks: { onChange?: () => void } = {}) {
  class WalletManagerRgb {
    private account: RgbLibRnAccount | null = null

    constructor(
      private readonly mnemonic: string,
      private readonly options: RgbLibRnOptions,
    ) {}

    async getAccount(): Promise<RgbLibRnAccount> {
      if (this.account) return this.account
      const lib = load()
      const network = libNetwork(this.options.network)
      if (!this.options.indexerUrl) throw new Error('RGB needs an indexer URL')
      if (!this.options.transportEndpoint) throw new Error('RGB needs a proxy endpoint')
      const subdir = rgbLibSubdir(this.options.dataDir)
      // An older native build would open the original folder instead: never let it.
      if (subdir && (lib as RgbModuleWithSubdir).supportsSubdir?.() !== true) {
        throw new Error('Update the app to use RGB on this network.')
      }
      const keys = await lib.restoreKeys(network, this.mnemonic)
      const walletOptions: WalletOptionsWithSubdir = subdir ? { network, subdir } : { network }
      const wallet = new lib.Wallet(keys, walletOptions)
      await wallet.goOnline(this.options.indexerUrl)
      this.account = new RgbLibRnAccount(lib, wallet, this.options.transportEndpoint, hooks.onChange, this.options.network)
      return this.account
    }

    async dispose(): Promise<void> {
      const account = this.account
      this.account = null
      await account?.dispose()
    }
  }
  return { WalletManagerRgb }
}
