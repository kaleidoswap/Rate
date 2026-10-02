// services/mempool/MempoolClient.ts
//
// Thin client for the mempool.space REST API: transaction status, fee rates,
// broadcast, and the Mempool Accelerator (mainnet only).
//
// Accelerator flow (no account needed), as used by mempool.space's own checkout:
//   1. POST /v1/services/accelerator/estimate  { txInput }      → quote + bid tiers
//   2. POST /v1/services/accelerator/invoice   { txid, maxBidBoost } → btcpayInvoiceId
//   3. GET  /v1/services/payments/bitcoin/invoice?id=…          → BOLT11 + amount
//   4. pay the BOLT11, then poll GET /v1/services/payments/bitcoin/check?order_id=…
//      (200 = settled, 204/504 = keep polling)
// The price for a tier is `bid + mempoolBaseFee + vsizeFee` (accelerate-checkout
// component in mempool/mempool).

export type MempoolNetwork = 'mainnet' | 'testnet' | 'signet' | 'mutinynet';

const SITE: Record<MempoolNetwork, string> = {
  mainnet: 'https://mempool.space',
  testnet: 'https://mempool.space/testnet4',
  signet: 'https://mempool.space/signet',
  mutinynet: 'https://mutinynet.com',
};

const SERVICES = 'https://mempool.space/api/v1/services';

export function isMempoolNetwork(n: string | undefined | null): n is MempoolNetwork {
  return !!n && n in SITE;
}

/** Explorer page for a transaction. On mainnet `#accelerate` opens the accelerator panel. */
export function mempoolTxUrl(txid: string, network: MempoolNetwork, accelerate = false): string {
  return `${SITE[network]}/tx/${txid}${accelerate && network === 'mainnet' ? '#accelerate' : ''}`;
}

export interface TxStatus {
  confirmed: boolean;
  blockHeight?: number;
  blockTime?: number;
}

export interface TxInfo {
  txid: string;
  fee: number;
  /** Virtual size, from weight. */
  vsize: number;
  status: TxStatus;
  /** BIP125: any input with nSequence below 0xfffffffe. */
  signalsRbf: boolean;
}

export interface FeeRates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

export interface AccelerationEstimate {
  txid: string;
  effectiveVsize: number;
  effectiveFee: number;
  ancestorCount: number;
  targetFeeRate: number;
  nextBlockFee: number;
  mempoolBaseFee: number;
  vsizeFee: number;
  /** Bid tiers (sats) mempool suggests, lowest first. */
  bids: number[];
  /** Lightning/on-chain payment limits in sats, when offered. */
  bitcoinPayment?: { min: number; max: number };
  /** Mempool says acceleration is temporarily unavailable. */
  unavailable: boolean;
}

export interface AccelerationInvoice {
  id: string;
  bolt11: string;
  /** Unix seconds, when given. */
  expiresAt?: number;
}

export type PaymentCheck = 'settled' | 'pending' | 'failed';

/** Thrown for a non-2xx response. `code` is mempool's error string when it sent one. */
export class MempoolError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'MempoolError';
  }
}

/** Total price of an acceleration at a given bid, in sats. */
export function accelerationPrice(e: AccelerationEstimate, bid: number): number {
  return bid + e.mempoolBaseFee + e.vsizeFee;
}

/** Fee rate (sat/vB) the transaction package reaches with a given bid. */
export function acceleratedFeeRate(e: AccelerationEstimate, bid: number): number {
  return (e.effectiveFee + bid) / e.effectiveVsize;
}

type Fetch = typeof fetch;

export class MempoolClient {
  private api: string;

  constructor(public network: MempoolNetwork, private http: Fetch = fetch) {
    this.api = `${SITE[network]}/api`;
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const r = await this.http(url, init);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let code: string | undefined;
      try { code = JSON.parse(text)?.error ?? JSON.parse(text)?.message; } catch { code = text.trim() || undefined; }
      throw new MempoolError(`mempool ${url.replace(/^https:\/\/[^/]+/, '')}: ${r.status}${code ? ` ${code}` : ''}`, r.status, code);
    }
    return r;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.request(url, init)).json() as Promise<T>;
  }

  async getTx(txid: string): Promise<TxInfo> {
    const t: any = await this.json(`${this.api}/tx/${txid}`);
    return {
      txid: t.txid,
      fee: Number(t.fee),
      vsize: Math.ceil(Number(t.weight) / 4),
      status: toStatus(t.status),
      signalsRbf: Array.isArray(t.vin) && t.vin.some((i: any) => Number(i.sequence) < 0xfffffffe),
    };
  }

  async getTxStatus(txid: string): Promise<TxStatus> {
    return toStatus(await this.json(`${this.api}/tx/${txid}/status`));
  }

  /** Recommended rates; `precise` keeps sub-sat/vB decimals. */
  async getFeeRates(): Promise<FeeRates> {
    const precise = await this.json<FeeRates>(`${this.api}/v1/fees/precise`).catch(() => null);
    return precise ?? this.json<FeeRates>(`${this.api}/v1/fees/recommended`);
  }

  async broadcast(hex: string): Promise<string> {
    return (await (await this.request(`${this.api}/tx`, { method: 'POST', body: hex })).text()).trim();
  }

  // ── Accelerator (mainnet only) ──────────────────────────────────────────

  get supportsAccelerator(): boolean {
    return this.network === 'mainnet';
  }

  private requireAccelerator(): void {
    if (!this.supportsAccelerator) throw new Error(`Mempool Accelerator is only available on mainnet, not ${this.network}.`);
  }

  async estimateAcceleration(txid: string): Promise<AccelerationEstimate> {
    this.requireAccelerator();
    const e: any = await this.json(`${SERVICES}/accelerator/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txInput: txid }),
    });
    const btc = e.availablePaymentMethods?.bitcoin;
    return {
      txid: e.txSummary?.txid ?? txid,
      effectiveVsize: Number(e.txSummary?.effectiveVsize),
      effectiveFee: Number(e.txSummary?.effectiveFee),
      ancestorCount: Number(e.txSummary?.ancestorCount ?? 1),
      targetFeeRate: Number(e.targetFeeRate),
      nextBlockFee: Number(e.nextBlockFee),
      mempoolBaseFee: Number(e.mempoolBaseFee ?? 0),
      vsizeFee: Number(e.vsizeFee ?? 0),
      bids: (e.options ?? []).map((o: any) => Number(o.fee)).filter((n: number) => n > 0).sort((a: number, b: number) => a - b),
      bitcoinPayment: btc?.enabled === false ? undefined : btc ? { min: Number(btc.min), max: Number(btc.max) } : undefined,
      unavailable: !!e.unavailable,
    };
  }

  /** Creates a Lightning invoice for accelerating `txid` with up to `bid` sats of bid boost. */
  async requestAccelerationInvoice(txid: string, bid: number): Promise<AccelerationInvoice> {
    this.requireAccelerator();
    const created: any = await this.json(`${SERVICES}/accelerator/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid, maxBidBoost: bid }),
    });
    const id = String(created.btcpayInvoiceId ?? '');
    if (!id) throw new Error('Mempool did not return an invoice id.');
    let invoice: any = created;
    if (!invoice.addresses?.BTC_LightningLike) {
      const fetched: any = await this.json(`${SERVICES}/payments/bitcoin/invoice?id=${encodeURIComponent(id)}`);
      invoice = Array.isArray(fetched) ? fetched[0] : fetched;
    }
    const bolt11 = invoice?.addresses?.BTC_LightningLike;
    if (!bolt11) throw new Error('Mempool did not return a Lightning invoice.');
    const exp = Number(invoice.expirationTime);
    return { id, bolt11: String(bolt11), expiresAt: Number.isFinite(exp) && exp > 0 ? exp : undefined };
  }

  async checkAccelerationPayment(invoiceId: string): Promise<PaymentCheck> {
    const r = await this.http(`${SERVICES}/payments/bitcoin/check?order_id=${encodeURIComponent(invoiceId)}`);
    if (r.status === 200) return 'settled';
    if (r.status === 204 || r.status === 504) return 'pending';
    return 'failed';
  }

  /** Whether mempool is currently accelerating this transaction. */
  async isAccelerating(txid: string): Promise<boolean> {
    if (!this.supportsAccelerator) return false;
    const r = await this.http(`${SERVICES}/accelerator/accelerations/${txid}`);
    if (!r.ok) return false;
    const a: any = await r.json().catch(() => null);
    return ['requested', 'accelerating'].includes(a?.status);
  }
}

function toStatus(s: any): TxStatus {
  return {
    confirmed: !!s?.confirmed,
    ...(s?.block_height != null ? { blockHeight: Number(s.block_height) } : {}),
    ...(s?.block_time != null ? { blockTime: Number(s.block_time) } : {}),
  };
}
