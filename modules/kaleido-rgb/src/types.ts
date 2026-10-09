/** rgb-lib's types as they cross the bridge (amounts are numbers: sats and asset units). */

export type BitcoinNetwork = 'MAINNET' | 'TESTNET' | 'TESTNET4' | 'SIGNET' | 'REGTEST' | 'SIGNET_CUSTOM'
export type AssetSchema = 'NIA' | 'UDA' | 'CFA' | 'IFA'
export type WitnessVersion = 'TAPROOT' | 'SEG_WIT_V0'
export type TransferKind = 'ISSUANCE' | 'RECEIVE_BLIND' | 'RECEIVE_WITNESS' | 'SEND' | 'INFLATION' | 'BURN'
export type TransferStatus =
  | 'INITIATED' | 'WAITING_COUNTERPARTY' | 'WAITING_SAFE_HEIGHT' | 'WAITING_BROADCAST'
  | 'WAITING_CONFIRMATIONS' | 'SETTLED' | 'FAILED'
export type RefreshTransferStatus = 'WAITING_COUNTERPARTY' | 'WAITING_SAFE_HEIGHT' | 'WAITING_BROADCAST' | 'WAITING_CONFIRMATIONS'
export type TransactionType = 'RGB_SEND' | 'DRAIN' | 'CREATE_UTXOS' | 'SEND_BTC' | 'INCOMING'
export type SyncStrategy = 'FULL_SCAN' | 'FULL_SYNC' | 'FAST_SYNC'

export interface Keys {
  mnemonic: string
  xpub: string
  accountXpubVanilla: string
  accountXpubColored: string
  masterFingerprint: string
  witnessVersion: WitnessVersion
}

export type Assignment =
  | { type: 'FUNGIBLE'; amount: number }
  | { type: 'NON_FUNGIBLE' }
  | { type: 'INFLATION_RIGHT'; amount: number }
  | { type: 'ANY' }

export interface Balance { settled: number; future: number; spendable: number }
export interface BtcBalance { vanilla: Balance; colored: Balance }

export interface Media { filePath: string; digest: string; mime: string }

export interface TokenLight {
  index: number
  ticker: string | null
  name: string | null
  details: string | null
  embeddedMedia: boolean
  media: Media | null
  attachments: Record<string, Media>
  reserves: boolean
}

export interface Token extends Omit<TokenLight, 'embeddedMedia'> {
  embeddedMedia: { mime: string; data: number[] } | null
}

interface AssetBase {
  assetId: string
  name: string
  details: string | null
  precision: number
  timestamp: number
  addedAt: number
  balance: Balance
  media: Media | null
}
export interface AssetNia extends AssetBase { ticker: string; issuedSupply: number }
export interface AssetCfa extends AssetBase { issuedSupply: number }
export interface AssetUda extends AssetBase { ticker: string; token: TokenLight | null }
export interface AssetIfa extends AssetBase {
  ticker: string
  initialSupply: number
  maxSupply: number
  knownCirculatingSupply: number
  rejectListUrl: string | null
}
export interface Assets {
  nia: AssetNia[] | null
  uda: AssetUda[] | null
  cfa: AssetCfa[] | null
  ifa: AssetIfa[] | null
}

export interface Metadata {
  assetSchema: AssetSchema
  initialSupply: number
  maxSupply: number
  knownCirculatingSupply: number
  timestamp: number
  name: string
  precision: number
  ticker: string | null
  details: string | null
  token: Token | null
  rejectListUrl: string | null
}

export interface ReceiveData { invoice: string; recipientId: string; expirationTimestamp: number; batchTransferIdx: number }

export interface WitnessData { amountSat: number; blinding?: number | null }
export interface Recipient {
  recipientId: string
  witnessData?: WitnessData | null
  assignment: Assignment
  transportEndpoints: string[]
}

/** `entropy` is a u64: a decimal string so it keeps every digit. */
export interface OperationResult { txid: string; batchTransferIdx: number; entropy: string }

export interface InvoiceData {
  recipientId: string
  assetSchema: AssetSchema | null
  assetId: string | null
  assignment: Assignment
  assignmentName: string | null
  network: BitcoinNetwork
  expirationTimestamp: number | null
  transportEndpoints: string[]
  unknownQueryParams: Record<string, string>
}

export interface BlockTime { height: number; timestamp: number }
export interface Transaction {
  transactionType: TransactionType
  txid: string
  received: number
  sent: number
  fee: number
  confirmationTime: BlockTime | null
}

export interface Outpoint { txid: string; vout: number }
export interface Transfer {
  idx: number
  batchTransferIdx: number
  createdAt: number
  updatedAt: number
  status: TransferStatus
  requestedAssignment: Assignment | null
  assignments: Assignment[]
  kind: TransferKind
  txid: string | null
  recipientId: string | null
  receiveUtxo: Outpoint | null
  changeUtxo: Outpoint | null
  expirationTimestamp: number | null
  transportEndpoints: { endpoint: string; transportType: 'JSON_RPC'; used: boolean }[]
  invoiceString: string | null
  consignmentPath: string | null
  psbtPath: string | null
}

export interface Unspent {
  utxo: { outpoint: Outpoint; btcAmount: number; colorable: boolean; exists: boolean; derivationIndex: number | null }
  rgbAllocations: { assetId: string | null; assignment: Assignment; settled: boolean }[]
  pendingBlinded: number
}

export interface RefreshFilter { status: RefreshTransferStatus; incoming: boolean }
/** Keyed by transfer idx. */
export type RefreshResult = Record<string, { updatedStatus: TransferStatus | null; failure: { code: string; message: string } | null }>

export type SyncOptions =
  | { keychain: 'COLORED'; strategy: SyncStrategy }
  | { keychain: 'VANILLA'; strategy: SyncStrategy; lookback: number }

/** What's in a wallet's folder before it opens (see ./legacy.ts). */
export interface WalletDirState {
  exists: boolean
  hasManifest: boolean
  hasBdkDb: boolean
  hasLegacyBdkBackup: boolean
}

export interface WalletOptions {
  network: BitcoinNetwork
  /** A folder of its own inside the module's data folder (letters, digits, - and _); none: the data folder itself. */
  subdir?: string | null
  supportedSchemas?: AssetSchema[]
  maxAllocationsPerUtxo?: number
  vanillaKeychain?: number
}
