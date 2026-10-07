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

/** 'RECEIVE_WITNESS' → 'ReceiveWitness', as the RGB node names transfer kinds and statuses. */
function pascal(value: string): string {
  return value.toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase())
}

/** The account the adapter talks to, over one native rgb-lib wallet. */
export class RgbLibRnAccount {
  private lastRefresh = 0
  private refreshing: Promise<void> | null = null

  constructor(
    private readonly lib: RgbModule,
    private readonly wallet: RgbLib.Wallet,
    private readonly transportEndpoint: string,
    /** Called after anything that changes what a backup holds (send, receive, settle). */
    private readonly onChange: () => void = () => undefined,
  ) {}

  /** Advance pending transfers and sync, at most every REFRESH_EVERY_MS (or now with force). */
  private async refresh(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing
    if (!force && Date.now() - this.lastRefresh < REFRESH_EVERY_MS) return
    this.refreshing = (async () => {
      try {
        const updated = await this.wallet.refresh(null, [], false)
        this.lastRefresh = Date.now()
        if (updated && Object.keys(updated).length) this.onChange() // a transfer moved: settle, receive, fail
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  /** The adapter's readiness probe and BTC balance source: `{ address, btcBalance }`. */
  async registerWallet(): Promise<{ address: string; btcBalance: RgbLib.BtcBalance }> {
    await this.refresh().catch(() => undefined) // a failed sync still leaves the last known balance
    const [address, btcBalance] = await Promise.all([this.wallet.getAddress(), this.wallet.getBtcBalance(true)])
    return { address, btcBalance }
  }

  getAddress(): Promise<string> {
    return this.wallet.getAddress()
  }

  // The adapter calls these without awaiting: never let them reject.
  refreshWallet(): Promise<void> {
    return this.refresh(true).catch((e) => console.warn('[RGB_L1] refresh failed:', e?.message ?? e))
  }

  syncWallet(): Promise<void> {
    return this.wallet.sync().catch((e) => console.warn('[RGB_L1] sync failed:', e?.message ?? e))
  }

  async listAssets(): Promise<RgbLib.Assets> {
    await this.refresh().catch(() => undefined)
    return this.wallet.listAssets(['NIA'])
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
    const data = await receive(
      assetId, assignment, params.durationSeconds ?? params.duration_seconds ?? null,
      [this.transportEndpoint], params.minConfirmations ?? params.min_confirmations ?? 1,
    )
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
    const recipient: RgbLib.Recipient = {
      recipientId: invoice.recipientId,
      assignment: { type: 'FUNGIBLE', amount: params.amount },
      transportEndpoints: endpoints,
      ...(witnessData ? { witnessData } : {}),
    }
    const result = await this.wallet.send(
      { [params.token]: [recipient] }, false, params.feeRate ?? DEFAULT_FEE_RATE, params.minConfirmations ?? 1,
    )
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
    const txid = await this.wallet.sendBtc(params.to, params.value, params.feeRate ?? DEFAULT_FEE_RATE)
    this.onChange()
    return txid
  }

  /** BTC history, with rgb-lib's confirmation time in the shape the adapter reads. */
  async listTransactions() {
    const txs = await this.wallet.listTransactions(true)
    return txs.map((t) => ({ ...t, confirmation_time: t.confirmationTime ? { timestamp: t.confirmationTime } : undefined }))
  }

  /** Transfers in the node's shape (Activity reads `kind`, `status`, `created_at`, `requested_assignment.value`). */
  async listTransfers(assetId: string | null) {
    const transfers = await this.wallet.listTransfers(assetId)
    return transfers.map((t) => ({
      ...t,
      kind: pascal(t.kind),
      status: pascal(t.status),
      created_at: t.createdAt,
      updated_at: t.updatedAt,
      requested_assignment: t.requestedAssignment ? { ...t.requestedAssignment, value: t.requestedAssignment.amount } : undefined,
      amount: t.assignments?.reduce((sum, a) => sum + (a.amount ?? 0), 0),
    }))
  }

  listUnspents(): Promise<RgbLib.Unspent[]> {
    return this.wallet.listUnspents(false, true)
  }

  /** Colorable UTXOs for receiving assets; broadcasts a transaction. */
  async createUtxos(params: { num?: number; size?: number; feeRate?: number; upTo?: boolean } = {}): Promise<number> {
    const created = await this.wallet.createUtxos(params.upTo ?? true, params.num ?? 5, params.size ?? null, params.feeRate ?? DEFAULT_FEE_RATE)
    this.lastRefresh = 0
    this.onChange()
    return created
  }

  signPsbt(psbt: string): Promise<string> {
    return this.wallet.signPsbt(psbt)
  }

  async issueAssetNia(params: { ticker: string; name: string; precision: number; amounts: number[] }): Promise<RgbLib.AssetNia> {
    const asset = await this.wallet.issueAssetNia(params.ticker, params.name, params.precision, params.amounts)
    this.onChange()
    return asset
  }

  /** Encrypted backup of everything the seed can't rebuild (RGB state, consignments). */
  backup(path: string, password: string): Promise<void> {
    return this.wallet.backup(path, password)
  }

  /** True when the wallet changed since its last backup. */
  backupRequired(): Promise<boolean> {
    return this.wallet.backupInfo()
  }

  dispose(): Promise<void> {
    return this.wallet.close()
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
      this.account = new RgbLibRnAccount(lib, wallet, this.options.transportEndpoint, hooks.onChange)
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
