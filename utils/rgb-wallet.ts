/**
 * The RGB account as an on-chain RGB wallet: what each backing supports, its
 * transfers and their progress, issuance input, and a single-flight poller.
 * Pure: the adapter calls live in services/rgbWallet.ts.
 */

export type RgbBackingKind = 'device' | 'engine-node' | 'nwc-node';
export type RgbIssueSchema = 'NIA' | 'CFA';

export interface RgbWalletSupport {
  kind: RgbBackingKind | null;
  listUtxos: boolean;
  createUtxos: boolean;
  /** Schemas this account can issue; empty when it can't issue. */
  issue: RgbIssueSchema[];
  listTransfers: boolean;
  refreshTransfers: boolean;
  /** Fail a transfer still waiting for its counterparty. */
  cancelTransfer: boolean;
}

export const NO_RGB_WALLET_SUPPORT: RgbWalletSupport = {
  kind: null, listUtxos: false, createUtxos: false, issue: [], listTransfers: false, refreshTransfers: false, cancelTransfer: false,
};

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
  account?: { issueAssetCfa?: unknown; failTransfer?: unknown; refreshTransfers?: unknown } | null;
}

/**
 * What the RGB account's adapter can do. RGB on this phone does everything (CFA
 * and cancelling need the app's rgb-lib bridge). The node through the engine
 * lists and refreshes, and creates UTXOs when privileged ops are on; it can't
 * issue. The node over NWC does what its connection advertises, never issuance.
 */
export function rgbWalletSupport(adapter: unknown): RgbWalletSupport {
  const a = adapter as AdapterLike | null | undefined;
  if (!a || a.isConnected?.() === false) return NO_RGB_WALLET_SUPPORT;
  if (typeof a.walletType === 'function') {
    if (a.walletType() === 'ln') return NO_RGB_WALLET_SUPPORT;
    const has = (m: string) => a.hasRlnMethod?.(m) === true;
    return {
      kind: 'nwc-node',
      listUtxos: has('rln_list_unspents'),
      createUtxos: has('rln_create_utxos'),
      issue: [],
      listTransfers: has('rln_list_transfers'),
      refreshTransfers: has('rln_refresh_transfers'),
      cancelTransfer: false,
    };
  }
  if (a.protocolName === 'RGB_L1') {
    const account = a.account ?? {};
    return {
      kind: 'device',
      listUtxos: typeof a.listUnspents === 'function',
      createUtxos: typeof a.createRgbUtxos === 'function',
      issue: [
        ...(typeof a.issueAssetNia === 'function' ? ['NIA' as const] : []),
        ...(typeof account.issueAssetCfa === 'function' ? ['CFA' as const] : []),
      ],
      listTransfers: typeof a.listTransfers === 'function',
      refreshTransfers: typeof account.refreshTransfers === 'function' || typeof a.refreshBalances === 'function',
      cancelTransfer: typeof account.failTransfer === 'function',
    };
  }
  if (a.protocolName === 'RGB_LN') {
    return {
      kind: 'engine-node',
      listUtxos: typeof a.executeProtocolOperation === 'function',
      createUtxos: typeof a.createRgbUtxos === 'function' && a.allowPrivilegedOps === true,
      issue: [],
      listTransfers: typeof a.listTransfers === 'function',
      refreshTransfers: typeof a.refreshBalances === 'function',
      cancelTransfer: false,
    };
  }
  return NO_RGB_WALLET_SUPPORT;
}

// ── Transfers ─────────────────────────────────────────────────────────────

export type RgbTransferStatus = 'waiting-counterparty' | 'waiting-confirmations' | 'settled' | 'failed';
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
  if (s === 'waitingcounterparty') return 'waiting-counterparty';
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
  'waiting-counterparty': 'Waiting for the other side',
  'waiting-confirmations': 'Waiting for confirmations',
  settled: 'Settled',
  failed: 'Failed',
};

/** What each step means for this direction, in plain words. */
export function rgbTransferStatusDetail(status: RgbTransferStatus, direction: RgbTransferDirection): string {
  switch (status) {
    case 'waiting-counterparty':
      return direction === 'incoming'
        ? 'Your invoice is open. Nothing has been sent to it yet.'
        : 'Sent to the recipient. Waiting for them to accept it.';
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

export function findRgbTransfer(transfers: RgbTransfer[], recipientId: string | undefined): RgbTransfer | undefined {
  return recipientId ? transfers.find(t => t.recipientId === recipientId) : undefined;
}

export const isPendingRgbTransfer = (t: Pick<RgbTransfer, 'status'>) =>
  t.status === 'waiting-counterparty' || t.status === 'waiting-confirmations';

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

/** An unused invoice that expired: a failed receive that never had a transaction. History leaves it out. */
export function isExpiredRgbInvoice(t: Pick<RgbTransfer, 'status' | 'direction' | 'txid'>): boolean {
  return t.status === 'failed' && t.direction === 'incoming' && !t.txid;
}

// ── Issuance ──────────────────────────────────────────────────────────────

export interface RgbIssueInput {
  schema: RgbIssueSchema;
  ticker: string;
  name: string;
  details: string;
  precision: string;
  amount: string;
}

export interface RgbIssueRequest {
  schema: RgbIssueSchema;
  ticker?: string;
  name: string;
  details?: string;
  precision: number;
  amounts: number[];
}

export type RgbIssueErrors = Partial<Record<'ticker' | 'name' | 'details' | 'precision' | 'amount', string>>;

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

/** Checks the issue form; `request` is set only when every field is valid. */
export function validateRgbIssue(input: RgbIssueInput): { errors: RgbIssueErrors; request?: RgbIssueRequest } {
  const errors: RgbIssueErrors = {};
  const ticker = input.ticker.trim().toUpperCase();
  const name = input.name.trim();
  const details = input.details.trim();
  if (input.schema === 'NIA') {
    if (!ticker) errors.ticker = 'Enter a ticker.';
    else if (!/^[A-Z][A-Z0-9]{0,7}$/.test(ticker)) errors.ticker = 'Up to 8 letters and digits, starting with a letter.';
  }
  if (!name) errors.name = 'Enter a name.';
  else if (name.length > MAX_NAME) errors.name = `Up to ${MAX_NAME} characters.`;
  else if (!/^[\x20-\x7E]+$/.test(name)) errors.name = 'Use plain letters, digits and punctuation.';
  if (details.length > MAX_DETAILS) errors.details = `Up to ${MAX_DETAILS} characters.`;
  const precision = Number(input.precision);
  const precisionOk = input.precision.trim() !== '' && Number.isInteger(precision) && precision >= 0 && precision <= RGB_MAX_PRECISION;
  if (!precisionOk) errors.precision = `A whole number from 0 to ${RGB_MAX_PRECISION}.`;
  const base = precisionOk ? toBaseUnits(input.amount, precision) : null;
  if (!input.amount.trim()) errors.amount = 'Enter the supply.';
  else if (precisionOk && base == null) {
    errors.amount = /\.(\d*)$/.test(input.amount.trim()) && (input.amount.trim().split('.')[1]?.length ?? 0) > precision
      ? `At most ${precision} decimal${precision === 1 ? '' : 's'}.`
      : 'Enter an amount above zero that isn’t too large.';
  }
  if (Object.keys(errors).length || base == null) return { errors };
  return {
    errors,
    request: {
      schema: input.schema,
      ...(input.schema === 'NIA' ? { ticker } : {}),
      name,
      ...(details ? { details } : {}),
      precision,
      amounts: [base],
    },
  };
}

/** Plain wording for the ways issuing, creating UTXOs or cancelling can fail. */
export function rgbWalletErrorMessage(error: unknown, action: 'issue' | 'utxos' | 'cancel'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/InsufficientAllocationSlots|No uncolored UTXOs|NoAvailableUtxos|no colorable UTXO/i.test(message)) {
    return 'You need a free colorable UTXO first. Create some, wait for them to confirm, then try again.';
  }
  if (/InsufficientBitcoins|insufficient funds|InsufficientFunds|not enough/i.test(message)) {
    return 'Not enough bitcoin in your RGB wallet to pay for this. Add some on-chain bitcoin first.';
  }
  if (/AllocationsAlreadyAvailable/i.test(message)) return 'You already have enough free UTXOs.';
  if (/CannotFailBatchTransfer/i.test(message)) return 'This transfer can no longer be cancelled.';
  if (/InvalidTicker/i.test(message)) return 'That ticker isn’t allowed. Use up to 8 capital letters and digits.';
  if (/InvalidName/i.test(message)) return 'That name isn’t allowed. Use plain letters and digits.';
  if (/InvalidPrecision/i.test(message)) return 'That number of decimals isn’t allowed.';
  if (/OutputBelowDustLimit/i.test(message)) return 'Each UTXO must hold more bitcoin. Pick a bigger size.';
  if (/timed out|timeout|Network|Indexer|Proxy|fetch/i.test(message)) return 'Couldn’t reach the network. Check your connection and try again.';
  if (action === 'issue') return 'The asset couldn’t be issued. Try again.';
  if (action === 'utxos') return 'The UTXOs couldn’t be created. Try again.';
  return 'The transfer couldn’t be cancelled. Try again.';
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
