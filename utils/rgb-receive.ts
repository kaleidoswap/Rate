/**
 * RGB on-chain receive: the invoice options the RGB account supports, the params
 * they map to, and its UTXOs. Pure apart from the adapter calls in the UTXO helpers.
 */

/** Sentinel asset id for an invoice that accepts any RGB asset (no asset id). */
export const ANY_RGB_ASSET_ID = 'RGB_NEW';

export type RgbInvoiceKind = 'witness' | 'blinded';

export interface RgbReceiveOptions {
  kind: RgbInvoiceKind;
  /** null keeps the request's own expiry. */
  durationSeconds: number | null;
  minConfirmations: number;
}

/** Today's invoice: witness, the request's expiry, one confirmation. */
export const DEFAULT_RGB_RECEIVE_OPTIONS: RgbReceiveOptions = { kind: 'witness', durationSeconds: null, minConfirmations: 1 };

export interface RgbReceiveSupport {
  invoiceKind: boolean;
  expiry: boolean;
  minConfirmations: boolean;
  listUtxos: boolean;
  createUtxos: boolean;
}

export const NO_RGB_RECEIVE_SUPPORT: RgbReceiveSupport = {
  invoiceKind: false, expiry: false, minConfirmations: false, listUtxos: false, createUtxos: false,
};

interface RgbAdapterLike {
  protocolName?: string;
  walletType?: () => string;
  listUnspents?: () => Promise<unknown>;
  createRgbUtxos?: (params: { num?: number; size?: number; feeRate?: number; upTo?: boolean }) => Promise<unknown>;
  executeProtocolOperation?: (operation: string, params: unknown) => Promise<unknown>;
  allowPrivilegedOps?: boolean;
}

/**
 * What the RGB account's adapter accepts. RGB on this phone takes everything. The
 * node through the engine takes the invoice options and lists UTXOs, but creates
 * them only when privileged ops are enabled. The node paired over NWC forwards
 * the invoice call as is: only expiry and confirmations are known to pass through,
 * and NWC has no UTXO methods.
 */
export function rgbReceiveSupport(adapter: unknown): RgbReceiveSupport {
  const a = adapter as RgbAdapterLike | null | undefined;
  if (!a) return NO_RGB_RECEIVE_SUPPORT;
  if (typeof a.walletType === 'function') {
    return { invoiceKind: false, expiry: true, minConfirmations: true, listUtxos: false, createUtxos: false };
  }
  const onDevice = a.protocolName === 'RGB_L1';
  const engineNode = a.protocolName === 'RGB_LN' && typeof a.executeProtocolOperation === 'function';
  return {
    invoiceKind: onDevice || engineNode,
    expiry: true,
    minConfirmations: true,
    listUtxos: typeof a.listUnspents === 'function' || engineNode,
    createUtxos: typeof a.createRgbUtxos === 'function' || (engineNode && a.allowPrivilegedOps === true),
  };
}

/** The createRgbInvoice params for an on-chain RGB receive. Defaults match the invoice Receive always made. */
export function rgbInvoiceParams({ assetId, expirySeconds, options = DEFAULT_RGB_RECEIVE_OPTIONS, support = NO_RGB_RECEIVE_SUPPORT }: {
  assetId: string;
  expirySeconds: number;
  options?: RgbReceiveOptions;
  support?: RgbReceiveSupport;
}): Record<string, unknown> {
  return {
    ...(assetId === ANY_RGB_ASSET_ID ? {} : { asset_id: assetId }),
    min_confirmations: support.minConfirmations ? options.minConfirmations : 1,
    duration_seconds: support.expiry && options.durationSeconds ? options.durationSeconds : expirySeconds,
    ...(support.invoiceKind && options.kind === 'blinded' ? { witness: false } : {}),
  };
}

/** True when nothing differs from the default invoice (the Advanced summary says "Default"). */
export function isDefaultRgbOptions(options: RgbReceiveOptions): boolean {
  return options.kind === DEFAULT_RGB_RECEIVE_OPTIONS.kind
    && options.durationSeconds === DEFAULT_RGB_RECEIVE_OPTIONS.durationSeconds
    && options.minConfirmations === DEFAULT_RGB_RECEIVE_OPTIONS.minConfirmations;
}

/** A contract id typed or pasted by the user, normalised; null when it isn't one. */
export function parseRgbContractId(input: string): string | null {
  const id = input.trim().replace(/^rgb:\/\//i, 'rgb:').split('#')[0];
  if (/^rgb:[A-Za-z0-9~_!$.-]{20,}$/.test(id)) return `rgb:${id.slice(4)}`;
  if (/^rgb1[a-z0-9]{20,}$/i.test(id)) return id.toLowerCase();
  return null;
}

/** A short form of a contract id for labels: rgb:CJkb4YZw…wTfvRZ8. */
export function shortContractId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
}

export interface RgbUtxo {
  outpoint: string;
  sats: number;
  colorable: boolean;
  allocations: number;
  pending: number;
}

/** UTXOs from rgb-lib (camelCase) or the node (snake_case, possibly wrapped in `unspents`). */
export function normalizeUnspents(raw: unknown): RgbUtxo[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.unspents) ? (raw as any).unspents : [];
  return list.map((u: any) => {
    const utxo = u?.utxo ?? {};
    const op = utxo.outpoint;
    return {
      outpoint: typeof op === 'string' ? op : op?.txid ? `${op.txid}:${op.vout}` : '',
      sats: Number(utxo.btcAmount ?? utxo.btc_amount ?? 0),
      colorable: !!utxo.colorable,
      allocations: (u?.rgbAllocations ?? u?.rgb_allocations ?? []).length,
      pending: Number(u?.pendingBlinded ?? u?.pending_blinded ?? 0),
    };
  }).filter((u: RgbUtxo) => !!u.outpoint);
}

/** Colorable UTXOs, and the free ones a blinded invoice can take. */
export function utxoCounts(utxos: RgbUtxo[]): { colorable: number; free: number } {
  const colorable = utxos.filter(u => u.colorable);
  return { colorable: colorable.length, free: colorable.filter(u => u.allocations === 0 && u.pending === 0).length };
}

export async function listRgbUtxos(adapter: unknown): Promise<RgbUtxo[]> {
  const a = adapter as RgbAdapterLike;
  if (typeof a?.listUnspents === 'function') return normalizeUnspents(await a.listUnspents());
  if (typeof a?.executeProtocolOperation === 'function') return normalizeUnspents(await a.executeProtocolOperation('listUnspents', { skip_sync: false }));
  return [];
}

/** Plain wording for the errors an RGB receive can fail with. */
export function rgbReceiveErrorMessage(message: string, { advanced, onDevice }: { advanced: boolean; onDevice: boolean }): string {
  if (/No uncolored UTXOs|InsufficientAllocationSlots|NoAvailableUtxos/i.test(message)) {
    const where = onDevice ? 'Your RGB wallet' : 'Your RGB Lightning node';
    return advanced
      ? `${where} has no free bitcoin output (UTXO) to receive this asset into. Create UTXOs under Advanced, or switch the invoice type to Witness.`
      : `${where} has no free bitcoin output to receive this asset into. Send a small amount of bitcoin to it on-chain first${onDevice ? '.' : ', or receive over Lightning.'}`;
  }
  return message;
}

export const RGB_EXPIRY_PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '10 min', seconds: 600 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
];

export const RGB_CONFIRMATION_PRESETS = [1, 3, 6] as const;
