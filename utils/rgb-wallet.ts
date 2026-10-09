/**
 * The RGB account as an on-chain RGB wallet: what each backing supports, its
 * transfers and their progress, issuance input, and a single-flight poller.
 * Pure: the adapter calls live in services/rgbWallet.ts.
 */

export type RgbBackingKind = 'device' | 'engine-node' | 'nwc-node';
export type RgbIssueSchema = 'NIA' | 'CFA' | 'UDA' | 'IFA';

export interface RgbWalletSupport {
  kind: RgbBackingKind | null;
  listUtxos: boolean;
  createUtxos: boolean;
  /** Schemas this account can issue; empty when it can't issue. */
  issue: RgbIssueSchema[];
  /** A CFA or UDA can be issued with an image from the phone. */
  issueMedia: boolean;
  /** Issue more of an IFA asset the wallet holds inflation rights for. */
  inflate: boolean;
  listTransfers: boolean;
  refreshTransfers: boolean;
  /** Fail a transfer still waiting for its counterparty. */
  cancelTransfer: boolean;
  /** Remove failed transfers from the history. */
  deleteTransfer: boolean;
  /** Read an asset's contract data (schema, supply, issuance time, media). */
  metadata: boolean;
  /** Send all plain bitcoin to an address. */
  drain: boolean;
}

export const NO_RGB_WALLET_SUPPORT: RgbWalletSupport = {
  kind: null, listUtxos: false, createUtxos: false, issue: [], issueMedia: false, inflate: false,
  listTransfers: false, refreshTransfers: false, cancelTransfer: false, deleteTransfer: false, metadata: false, drain: false,
};

/** What the app's rgb-lib bridge reports its native build can do (services/protocols/rgbLibRn.ts). */
interface DeviceCapabilities {
  metadata?: boolean;
  issueUda?: boolean;
  issueIfa?: boolean;
  inflate?: boolean;
  drain?: boolean;
  deleteTransfers?: boolean;
}

interface AdapterLike {
  protocolName?: string;
  isConnected?: () => boolean;
  walletType?: () => string;
  hasRlnMethod?: (method: string) => boolean;
  listUnspents?: unknown;
  createRgbUtxos?: unknown;
  issueAssetNia?: unknown;
  listTransfers?: unknown;
  refreshBalances?: unknown;
  executeProtocolOperation?: unknown;
  allowPrivilegedOps?: boolean;
  account?: { issueAssetCfa?: unknown; failTransfer?: unknown; refreshTransfers?: unknown; capabilities?: () => DeviceCapabilities } | null;
}

/**
 * What the RGB account's adapter can do. RGB on this phone does everything its
 * native build offers (CFA, UDA, IFA, cancelling, cleanup, drain need the app's
 * rgb-lib bridge). The node through the engine lists, refreshes, reads metadata
 * and cancels, and creates UTXOs when privileged ops are on; it can't issue. The
 * node over NWC does what its connection advertises, never issuance.
 */
export function rgbWalletSupport(adapter: unknown): RgbWalletSupport {
  const a = adapter as AdapterLike | null | undefined;
  if (!a || a.isConnected?.() === false) return NO_RGB_WALLET_SUPPORT;
  if (typeof a.walletType === 'function') {
    if (a.walletType() === 'ln') return NO_RGB_WALLET_SUPPORT;
    const has = (m: string) => a.hasRlnMethod?.(m) === true;
    return {
      ...NO_RGB_WALLET_SUPPORT,
      kind: 'nwc-node',
      listUtxos: has('rln_list_unspents'),
      createUtxos: has('rln_create_utxos'),
      listTransfers: has('rln_list_transfers'),
      refreshTransfers: has('rln_refresh_transfers'),
    };
  }
  if (a.protocolName === 'RGB_L1') {
    const account = a.account ?? {};
    const caps: DeviceCapabilities = typeof account.capabilities === 'function' ? account.capabilities() : {};
    const cfa = typeof account.issueAssetCfa === 'function';
    return {
      kind: 'device',
      listUtxos: typeof a.listUnspents === 'function',
      createUtxos: typeof a.createRgbUtxos === 'function',
      issue: [
        ...(typeof a.issueAssetNia === 'function' ? ['NIA' as const] : []),
        ...(cfa ? ['CFA' as const] : []),
        ...(caps.issueUda ? ['UDA' as const] : []),
        ...(caps.issueIfa ? ['IFA' as const] : []),
      ],
      issueMedia: cfa || !!caps.issueUda,
      inflate: !!caps.inflate,
      listTransfers: typeof a.listTransfers === 'function',
      refreshTransfers: typeof account.refreshTransfers === 'function' || typeof a.refreshBalances === 'function',
      cancelTransfer: typeof account.failTransfer === 'function',
      deleteTransfer: !!caps.deleteTransfers,
      metadata: !!caps.metadata,
      drain: !!caps.drain,
    };
  }
  if (a.protocolName === 'RGB_LN') {
    const ops = typeof a.executeProtocolOperation === 'function';
    return {
      ...NO_RGB_WALLET_SUPPORT,
      kind: 'engine-node',
      listUtxos: ops,
      createUtxos: typeof a.createRgbUtxos === 'function' && a.allowPrivilegedOps === true,
      listTransfers: typeof a.listTransfers === 'function',
      refreshTransfers: typeof a.refreshBalances === 'function',
      // The node's failtransfers takes a batch index: offered only on transfers that carry one.
      cancelTransfer: ops,
      metadata: ops,
    };
  }
  return NO_RGB_WALLET_SUPPORT;
}

// ── Transfers ─────────────────────────────────────────────────────────────

/**
 * rgb-lib's transfer steps, in order: being prepared, waiting for the other side,
 * waiting for blocks before going on (safe height), waiting for its transaction to be
 * broadcast, waiting for confirmations, then settled or failed.
 */
export type RgbTransferStatus =
  | 'initiated' | 'waiting-counterparty' | 'waiting-safe-height' | 'waiting-broadcast'
  | 'waiting-confirmations' | 'settled' | 'failed';
export type RgbTransferDirection = 'incoming' | 'outgoing' | 'issuance';

export interface RgbTransfer {
  idx: number;
  /** rgb-lib's batch index, what cancelling takes (RGB on this phone only). */
  batchTransferIdx?: number;
  status: RgbTransferStatus;
  direction: RgbTransferDirection;
  kind: string;
  /** Base units. */
  amount: number;
  txid?: string;
  recipientId?: string;
  createdAt?: number;
  updatedAt?: number;
  expiration?: number;
}

/** 'WaitingCounterparty', 'WAITING_COUNTERPARTY' or 'waiting_counterparty' → one status; null when unknown. */
export function rgbTransferStatus(raw: unknown): RgbTransferStatus | null {
  const s = String(raw ?? '').replace(/[\s_-]/g, '').toLowerCase();
  if (s === 'initiated') return 'initiated';
  if (s === 'waitingcounterparty') return 'waiting-counterparty';
  if (s === 'waitingsafeheight') return 'waiting-safe-height';
  if (s === 'waitingbroadcast') return 'waiting-broadcast';
  if (s === 'waitingconfirmations') return 'waiting-confirmations';
  if (s === 'settled') return 'settled';
  if (s === 'failed') return 'failed';
  return null;
}

export function rgbTransferDirection(kind: unknown): RgbTransferDirection {
  const k = String(kind ?? '').replace(/[\s_-]/g, '').toLowerCase();
  if (k.startsWith('receive')) return 'incoming';
  if (k === 'issuance' || k === 'inflation') return 'issuance';
  return 'outgoing';
}

export const RGB_TRANSFER_STATUS_LABEL: Record<RgbTransferStatus, string> = {
  initiated: 'Being prepared',
  'waiting-counterparty': 'Waiting for the other side',
  'waiting-safe-height': 'Waiting for more blocks',
  'waiting-broadcast': 'About to be broadcast',
  'waiting-confirmations': 'Waiting for confirmations',
  settled: 'Settled',
  failed: 'Failed',
};

/** What each step means for this direction, in plain words. */
export function rgbTransferStatusDetail(status: RgbTransferStatus, direction: RgbTransferDirection): string {
  switch (status) {
    case 'initiated':
      return direction === 'incoming'
        ? 'Your invoice is being set up.'
        : direction === 'issuance' ? 'Being prepared on this phone.' : 'Being prepared on this phone. Nothing has been sent yet.';
    case 'waiting-counterparty':
      return direction === 'incoming'
        ? 'Your invoice is open. Nothing has been sent to it yet.'
        : 'Sent to the recipient. Waiting for them to accept it.';
    case 'waiting-safe-height':
      return 'Waiting for a few more bitcoin blocks before it can go ahead.';
    case 'waiting-broadcast':
      return direction === 'incoming'
        ? 'Accepted. Waiting for the sender’s bitcoin transaction to be broadcast.'
        : 'Accepted. Its bitcoin transaction is about to be broadcast.';
    case 'waiting-confirmations':
      return 'In a bitcoin transaction. It counts once the transaction confirms.';
    case 'settled':
      return direction === 'incoming' ? 'Received and confirmed.' : direction === 'issuance' ? 'Issued.' : 'Delivered and confirmed.';
    case 'failed':
      return direction === 'incoming' ? 'Expired or cancelled. Nothing was received.' : 'Did not go through. Nothing left your wallet.';
  }
}

const num = (v: unknown): number | undefined => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** Transfers from rgb-lib (via the app's bridge) or a node, `{ transfers }` or a bare list. */
export function normalizeRgbTransfers(raw: unknown): RgbTransfer[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.transfers) ? (raw as any).transfers : [];
  const out: RgbTransfer[] = [];
  for (const t of list) {
    const status = rgbTransferStatus(t?.status);
    if (!status) continue;
    const requested = num(t.requested_assignment?.value ?? t.requested_assignment?.amount ?? t.requestedAssignment?.amount);
    const moved = Array.isArray(t.assignments)
      ? t.assignments.reduce((sum: number, a: any) => sum + (num(a?.value ?? a?.amount) ?? 0), 0)
      : num(t.amount) ?? 0;
    out.push({
      idx: Number(t.idx ?? 0),
      batchTransferIdx: num(t.batch_transfer_idx ?? t.batchTransferIdx),
      status,
      direction: rgbTransferDirection(t.kind),
      kind: String(t.kind ?? ''),
      amount: requested ?? moved,
      txid: t.txid || undefined,
      recipientId: t.recipient_id ?? t.recipientId ?? undefined,
      createdAt: num(t.created_at ?? t.createdAt),
      updatedAt: num(t.updated_at ?? t.updatedAt),
      expiration: num(t.expiration),
    });
  }
  return out;
}

/**
 * A plain name for the RGB wallet's own bitcoin transactions that aren't a plain
 * send or receive ('CREATE_UTXOS', the node's 'CreateUtxos', …); null otherwise
 * (incoming ones, 'INCOMING' since rgb-lib 0.3.0-beta.6, read as a receive).
 */
export function rgbOnchainKindLabel(kind: unknown): string | null {
  const k = String(kind ?? '').replace(/[\s_-]/g, '').toLowerCase();
  if (k === 'createutxos') return 'UTXOs created';
  if (k === 'drain') return 'Bitcoin drained';
  return null;
}

export function findRgbTransfer(transfers: RgbTransfer[], recipientId: string | undefined): RgbTransfer | undefined {
  return recipientId ? transfers.find(t => t.recipientId === recipientId) : undefined;
}

export const isPendingRgbTransfer = (t: Pick<RgbTransfer, 'status'>) =>
  t.status !== 'settled' && t.status !== 'failed';

export function hasPendingRgbTransfers(transfers: Array<Pick<RgbTransfer, 'status'>>): boolean {
  return transfers.some(isPendingRgbTransfer);
}

/** A key that changes whenever any transfer's status does (or one appears). */
export function rgbTransfersSignature(transfers: RgbTransfer[]): string {
  return transfers.map(t => `${t.idx}:${t.status}:${t.txid ?? ''}`).sort().join('|');
}

/** Only a transfer still waiting for its counterparty can be failed, and only where the account supports it. */
export function canCancelRgbTransfer(t: Pick<RgbTransfer, 'status' | 'batchTransferIdx'>, support: Pick<RgbWalletSupport, 'cancelTransfer'>): boolean {
  return support.cancelTransfer && t.status === 'waiting-counterparty' && t.batchTransferIdx != null;
}

/** Only a failed transfer can be removed from the history, and only where the account supports it. */
export function canDeleteRgbTransfer(t: Pick<RgbTransfer, 'status' | 'batchTransferIdx'>, support: Pick<RgbWalletSupport, 'deleteTransfer'>): boolean {
  return support.deleteTransfer && t.status === 'failed' && t.batchTransferIdx != null;
}

/**
 * How Receive follows an RGB invoice: its own transfer by recipient id where the
 * account lists transfers, else the asset's balance (`fallback`).
 */
export function rgbInvoiceWatch(invoice: { recipient_id?: string; recipientId?: string } | null | undefined,
  support: Pick<RgbWalletSupport, 'listTransfers'>, fallback: 'balance' | 'none' = 'balance'): { monitor: 'rgb-transfer' | 'balance' | 'none'; recipientId?: string } {
  const recipientId = invoice?.recipient_id ?? invoice?.recipientId;
  return recipientId && support.listTransfers ? { monitor: 'rgb-transfer', recipientId } : { monitor: fallback };
}

/** An unused invoice that expired: a failed receive that never had a transaction. History leaves it out. */
export function isExpiredRgbInvoice(t: Pick<RgbTransfer, 'status' | 'direction' | 'txid'>): boolean {
  return t.status === 'failed' && t.direction === 'incoming' && !t.txid;
}

export type RgbReceiveStage = 'watching' | 'pending' | 'confirmed' | 'expired' | 'failed';

/** Where an invoice's incoming transfer is, for Receive's status line. */
export function rgbReceiveStage(t: Pick<RgbTransfer, 'status' | 'expiration'> | undefined, nowSeconds = Date.now() / 1000): { stage: RgbReceiveStage; message: string } {
  if (!t || t.status === 'initiated' || t.status === 'waiting-counterparty') return { stage: 'watching', message: 'Waiting for the sender to send the asset.' };
  if (t.status === 'waiting-safe-height') return { stage: 'pending', message: 'Received. Waiting for a few more bitcoin blocks before it can go ahead.' };
  if (t.status === 'waiting-broadcast') return { stage: 'pending', message: 'Received. Waiting for the sender’s bitcoin transaction to be broadcast.' };
  if (t.status === 'waiting-confirmations') return { stage: 'pending', message: 'Received. It counts once the sender’s bitcoin transaction confirms.' };
  if (t.status === 'settled') return { stage: 'confirmed', message: 'Received and confirmed.' };
  if (t.expiration && t.expiration < nowSeconds) return { stage: 'expired', message: 'This invoice expired before anything was sent. Make a new one.' };
  return { stage: 'failed', message: 'The transfer didn’t go through. Nothing was received. Make a new invoice to try again.' };
}

// ── Issuance ──────────────────────────────────────────────────────────────

export interface RgbIssueInput {
  schema: RgbIssueSchema;
  ticker: string;
  name: string;
  details: string;
  precision: string;
  amount: string;
  /** IFA: how much more may be issued later. */
  inflation?: string;
  /** CFA, UDA: a local image file for the asset. */
  mediaPath?: string;
}

export interface RgbIssueRequest {
  schema: RgbIssueSchema;
  ticker?: string;
  name: string;
  details?: string;
  precision: number;
  amounts: number[];
  inflationAmounts?: number[];
  mediaPath?: string;
}

export type RgbIssueErrors = Partial<Record<'ticker' | 'name' | 'details' | 'precision' | 'amount' | 'inflation', string>>;

const TICKER_SCHEMAS: RgbIssueSchema[] = ['NIA', 'UDA', 'IFA'];

export const RGB_MAX_PRECISION = 18;
const MAX_NAME = 40;
const MAX_DETAILS = 255;

/** "1,000.5" at precision 2 → 100050; null when it isn't a positive amount with at most `precision` decimals. */
export function toBaseUnits(amount: string, precision: number): number | null {
  const clean = amount.trim().replace(/[,_\s]/g, '');
  const m = /^(\d*)(?:\.(\d*))?$/.exec(clean);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = m[2] ?? '';
  if (frac.length > precision) return null;
  const digits = `${m[1] || '0'}${frac.padEnd(precision, '0')}`.replace(/^0+(?=\d)/, '');
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function amountError(raw: string, precision: number, empty: string): string {
  const value = raw.trim();
  if (!value) return empty;
  return /\.(\d*)$/.test(value) && (value.split('.')[1]?.length ?? 0) > precision
    ? `At most ${precision} decimal${precision === 1 ? '' : 's'}.`
    : 'Enter an amount above zero that isn’t too large.';
}

/**
 * Checks the issue form; `request` is set only when every field is valid. A UDA is
 * one indivisible unit (no supply or decimals); an IFA also takes how much more
 * may be issued later.
 */
export function validateRgbIssue(input: RgbIssueInput): { errors: RgbIssueErrors; request?: RgbIssueRequest } {
  const errors: RgbIssueErrors = {};
  const ticker = input.ticker.trim().toUpperCase();
  const name = input.name.trim();
  const details = input.details.trim();
  const unique = input.schema === 'UDA';
  if (TICKER_SCHEMAS.includes(input.schema)) {
    if (!ticker) errors.ticker = 'Enter a ticker.';
    else if (!/^[A-Z][A-Z0-9]{0,7}$/.test(ticker)) errors.ticker = 'Up to 8 letters and digits, starting with a letter.';
  }
  if (!name) errors.name = 'Enter a name.';
  else if (name.length > MAX_NAME) errors.name = `Up to ${MAX_NAME} characters.`;
  else if (!/^[\x20-\x7E]+$/.test(name)) errors.name = 'Use plain letters, digits and punctuation.';
  if (details.length > MAX_DETAILS) errors.details = `Up to ${MAX_DETAILS} characters.`;
  const precision = unique ? 0 : Number(input.precision);
  const precisionOk = unique || (input.precision.trim() !== '' && Number.isInteger(precision) && precision >= 0 && precision <= RGB_MAX_PRECISION);
  if (!precisionOk) errors.precision = `A whole number from 0 to ${RGB_MAX_PRECISION}.`;
  const base = unique ? 1 : precisionOk ? toBaseUnits(input.amount, precision) : null;
  if (!unique && (!input.amount.trim() || (precisionOk && base == null))) errors.amount = amountError(input.amount, precision, 'Enter the supply.');
  let inflation: number | null = null;
  if (input.schema === 'IFA' && precisionOk) {
    inflation = toBaseUnits(input.inflation ?? '', precision);
    if (inflation == null) errors.inflation = amountError(input.inflation ?? '', precision, 'Enter how much more may be issued later.');
    else if (base != null && !Number.isSafeInteger(base + inflation)) errors.inflation = 'The total supply would be too large.';
  }
  if (Object.keys(errors).length || base == null) return { errors };
  const media = (input.schema === 'CFA' || unique) && input.mediaPath ? input.mediaPath : undefined;
  return {
    errors,
    request: {
      schema: input.schema,
      ...(TICKER_SCHEMAS.includes(input.schema) ? { ticker } : {}),
      name,
      ...(details ? { details } : {}),
      precision,
      amounts: [base],
      ...(inflation != null ? { inflationAmounts: [inflation] } : {}),
      ...(media ? { mediaPath: media } : {}),
    },
  };
}

/** Checks an amount to inflate an IFA asset by, against the rights left; base units when valid. */
export function validateRgbInflate(amount: string, precision: number, rights: number): { error?: string; amount?: number } {
  const base = toBaseUnits(amount, precision);
  if (base == null) return { error: amountError(amount, precision, 'Enter how much to issue.') };
  if (base > rights) return { error: 'That’s more than your inflation rights allow.' };
  return { amount: base };
}

/** Checks a drain destination: a bitcoin address on the RGB account's network. */
export function validateDrainAddress(address: string, addressNetworks: string[] | null, network: string | undefined): string | null {
  if (!address.trim()) return 'Enter a bitcoin address.';
  if (!addressNetworks) return 'That isn’t a bitcoin address.';
  if (network && !addressNetworks.includes(network)) return `That address isn’t on ${network === 'mainnet' ? 'bitcoin mainnet' : network}.`;
  return null;
}

/** Plain wording for the ways issuing, creating UTXOs or cancelling can fail. */
export function rgbWalletErrorMessage(error: unknown, action: 'issue' | 'utxos' | 'cancel' | 'delete' | 'inflate' | 'drain'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/InsufficientAllocationSlots|No uncolored UTXOs|NoAvailableUtxos|no colorable UTXO/i.test(message)) {
    return 'You need a free colorable UTXO first. Create some, wait for them to confirm, then try again.';
  }
  if (/InsufficientBitcoins|insufficient funds|InsufficientFunds|not enough/i.test(message)) {
    return 'Not enough bitcoin in your RGB wallet to pay for this. Add some on-chain bitcoin first.';
  }
  if (/AllocationsAlreadyAvailable/i.test(message)) return 'You already have enough free UTXOs.';
  if (/CannotFailBatchTransfer/i.test(message)) return 'This transfer can no longer be cancelled.';
  if (/CannotDeleteBatchTransfer/i.test(message)) return 'Only failed transfers can be removed.';
  if (/CannotUseIfaOnMainnet/i.test(message)) return 'Inflatable assets aren’t available on mainnet yet.';
  if (/InvalidAddress|invalid address/i.test(message) && action === 'drain') return 'That address can’t receive this. Check it and try again.';
  if (/NoInflationAmounts|InsufficientAssignments|InflationRight/i.test(message)) return 'Not enough inflation rights left for that amount.';
  if (/InvalidFilePath|FileNotFound|No such file/i.test(message)) return 'The image couldn’t be read. Pick it again.';
  if (/InvalidTicker/i.test(message)) return 'That ticker isn’t allowed. Use up to 8 capital letters and digits.';
  if (/InvalidName/i.test(message)) return 'That name isn’t allowed. Use plain letters and digits.';
  if (/InvalidPrecision/i.test(message)) return 'That number of decimals isn’t allowed.';
  if (/OutputBelowDustLimit/i.test(message)) return 'Each UTXO must hold more bitcoin. Pick a bigger size.';
  if (/timed out|timeout|Network|Indexer|Proxy|fetch/i.test(message)) return 'Couldn’t reach the network. Check your connection and try again.';
  if (action === 'issue') return 'The asset couldn’t be issued. Try again.';
  if (action === 'utxos') return 'The UTXOs couldn’t be created. Try again.';
  if (action === 'delete') return 'The transfer couldn’t be removed. Try again.';
  if (action === 'inflate') return 'The new supply couldn’t be issued. Try again.';
  if (action === 'drain') return 'The bitcoin couldn’t be sent. Nothing left your wallet. Try again.';
  return 'The transfer couldn’t be cancelled. Try again.';
}

// ── Asset metadata ────────────────────────────────────────────────────────

export interface RgbAssetMetadata {
  schema?: string;
  ticker?: string;
  name?: string;
  precision?: number;
  /** Base units issued so far (IFA: known circulating supply). */
  issuedSupply?: number;
  /** IFA: the most that can ever exist. */
  maxSupply?: number;
  details?: string;
  /** Seconds. */
  timestamp?: number;
  media?: { uri: string; mime: string; isImage: boolean };
}

/** rgb-lib's metadata (camelCase, from the bridge) or the node's (snake_case), in one shape. */
export function normalizeRgbAssetMetadata(raw: any): RgbAssetMetadata {
  if (!raw || typeof raw !== 'object') return {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  const schema = str(raw.assetSchema ?? raw.asset_schema ?? raw.schema)?.toUpperCase();
  const issued = num(raw.knownCirculatingSupply ?? raw.known_circulating_supply ?? raw.issuedSupply ?? raw.issued_supply ?? raw.initialSupply ?? raw.initial_supply);
  const max = num(raw.maxSupply ?? raw.max_supply);
  const path = str(raw.media?.filePath ?? raw.media?.file_path);
  const mime = str(raw.media?.mime) ?? '';
  return {
    schema,
    ticker: str(raw.ticker),
    name: str(raw.name),
    precision: num(raw.precision),
    issuedSupply: issued,
    ...(schema === 'IFA' && max != null ? { maxSupply: max } : {}),
    details: str(raw.details),
    timestamp: num(raw.timestamp),
    ...(path ? { media: { uri: /^[a-z]+:\/\//i.test(path) ? path : `file://${path}`, mime, isImage: /^image\//i.test(mime) } } : {}),
  };
}

export const RGB_SCHEMA_LABEL: Record<string, string> = {
  NIA: 'Token (NIA)', CFA: 'Collectible (CFA)', UDA: 'Unique collectible (UDA)', IFA: 'Inflatable token (IFA)',
};

// ── UTXO creation ─────────────────────────────────────────────────────────

export const RGB_UTXO_COUNTS = [1, 3, 5, 10] as const;
export const RGB_UTXO_SIZES = [1000, 3000, 10_000] as const;

/** What creating `num` UTXOs of `size` sats costs at `feeRate`, and whether the plain bitcoin covers it. */
export function createUtxosEstimate({ num, size, feeRate, bitcoinSats }: {
  num: number; size: number; feeRate: number; bitcoinSats?: number;
}): { feeSats: number; totalSats: number; enough: boolean } {
  // A couple of inputs, one output per UTXO, and change.
  const feeSats = Math.ceil((110 + 43 * num) * feeRate);
  const totalSats = num * size + feeSats;
  return { feeSats, totalSats, enough: bitcoinSats == null || totalSats <= bitcoinSats };
}

// ── Polling ───────────────────────────────────────────────────────────────

/**
 * Runs `tick` every `intervalMs`, starting after `initialDelayMs`. Single-flight:
 * the next run is scheduled only after the last one finished. Stops when `tick`
 * resolves false, or when the returned function is called.
 */
export function startPolling({ tick, intervalMs, initialDelayMs = 0 }: {
  tick: () => Promise<boolean>;
  intervalMs: number;
  initialDelayMs?: number;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    if (stopped) return;
    tick().then(keep => keep, () => true).then(keep => {
      if (!stopped && keep) timer = setTimeout(run, intervalMs);
    });
  };
  timer = setTimeout(run, initialDelayMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
