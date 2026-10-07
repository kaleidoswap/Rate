/**
 * Flashnet Orchestra REST client: cross-chain transfers between external chains
 * (USDC/USDT/ETH/SOL/TRX on EVM, Solana, Tron) and BTC/USDB on Spark.
 *
 * Used by the Receive bridge (external chain → Spark) and by Send to an
 * external-chain address (Spark → external chain).
 * API docs: https://docs.flashnet.xyz/products/orchestration/overview
 */
const BASE_URL = 'https://orchestration.flashnet.xyz';

// Public client key (fnp_*), shipped in the bundle by design.
const API_KEY: string = process.env.EXPO_PUBLIC_FLASHNET_ORCHESTRA_KEY || '';

// Client keys need an Origin on every authed request (a presence check, not an
// allowlist). Browsers add it to POSTs only; React Native adds none, so send it.
const ORIGIN = 'https://kaleidoswap.com';

/** A stalled request must not hang a spinner or a poll forever. */
const REQUEST_TIMEOUT_MS = 15_000;

export const ORCHESTRA_AUTH_ERROR_CODE = 'ORCHESTRA_AUTH_FAILED';
export const ORCHESTRA_ORIGIN_ERROR_CODE = 'ORCHESTRA_ORIGIN_MISSING';

export class OrchestraAuthError extends Error {
  constructor(readonly status: number) {
    super(`${ORCHESTRA_AUTH_ERROR_CODE}: Cross-chain transfers aren't available right now.`);
    this.name = 'OrchestraAuthError';
  }
}

export class OrchestraOriginError extends Error {
  constructor() {
    super(`${ORCHESTRA_ORIGIN_ERROR_CODE}: Order tracking is unavailable; the transfer may still complete.`);
    this.name = 'OrchestraOriginError';
  }
}

export function isOrchestraConfigured(): boolean {
  return API_KEY.length > 0;
}

export interface OrchestraRouteAsset {
  chain: string;
  asset: string;
  contractAddress?: string;
  decimals: number;
  chainId?: number;
}

export interface OrchestraRoute {
  sourceChain: string;
  sourceAsset: string;
  destinationChain: string;
  destinationAsset: string;
  source?: OrchestraRouteAsset;
  destination?: OrchestraRouteAsset;
  exactOutEligible?: boolean;
  fixedEligible?: boolean;
}

export type OrchestraAmountMode = 'exact_in' | 'exact_out';

/** `/estimate` and `/quote` give the hop path as tickers; `/routes` gives objects. Read with `routeHops()`. */
export type OrchestraRoutePath = OrchestraRoute | string[];

export interface OrchestraEstimate {
  estimatedOut: string;
  feeAmount: string;
  feeBps: number;
  totalFeeAmount: string;
  roundingFeeAmount?: string;
  feeAsset: string;
  route: OrchestraRoutePath;
  requiredAmountIn?: string;
  amountMode?: OrchestraAmountMode;
}

export interface OrchestraQuote {
  quoteId: string;
  depositAddress: string;
  amountIn: string;
  estimatedOut: string;
  feeAmount: string;
  feeBps: number;
  totalFeeAmount: string;
  roundingFeeAmount?: string;
  feeAsset: string;
  route: OrchestraRoutePath;
  expiresAt: string;
  amountMode?: OrchestraAmountMode;
  targetAmountOut?: string;
  requiredAmountIn?: string;
  maxAcceptedAmountIn?: string;
}

export type OrchestraOrderStatus =
  | 'processing'
  | 'confirming'
  | 'bridging'
  | 'swapping'
  | 'awaiting_approval'
  | 'refunding'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'refunded';

export interface OrchestraOrderStage {
  stage: string;
  timestamp: string;
}

export interface OrchestraOrder {
  id: string;
  quoteId: string;
  status: OrchestraOrderStatus;
  amountIn?: string;
  amountOut?: string;
  depositAddress?: string;
  recipientAddress?: string;
  stages?: OrchestraOrderStage[];
  createdAt?: string;
  updatedAt?: string;
  /** Issued at submit; client keys can't read an order's status without it. */
  readToken?: string;
}

interface OrchestraOrderLookup {
  quote: OrchestraQuote | null;
  order: OrchestraOrder | null;
  stages?: OrchestraOrderStage[];
}

export interface CreateQuoteParams {
  sourceChain: string;
  sourceAsset: string;
  destinationChain: string;
  destinationAsset: string;
  /** exact_in: source amount in smallest units. Ignored for exact_out. */
  amount: string;
  recipientAddress: string;
  slippageBps?: number;
  amountMode?: OrchestraAmountMode;
  /** Required for exact_out: destination amount to deliver. */
  targetAmountOut?: string;
}

export interface SubmitOrderParams {
  quoteId: string;
  txHash?: string;
  sourceAddress?: string;
  sparkTxHash?: string;
  sourceSparkAddress?: string;
  bitcoinTxid?: string;
  bitcoinVout?: number;
}

export interface EstimateParams {
  sourceChain: string;
  sourceAsset: string;
  destinationChain: string;
  destinationAsset: string;
  amount: string;
  amountMode?: OrchestraAmountMode;
  targetAmountOut?: string;
}

export interface SubmittedOrder {
  orderId: string;
  status: string;
  readToken?: string;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts?: {
    params?: Record<string, string>;
    body?: unknown;
    auth?: boolean;
    idempotency?: string;
    /** Same key on every retry of one logical operation, so the server can dedupe it. */
    idempotencyKey?: string;
  },
): Promise<T> {
  const query = opts?.params
    ? Object.entries(opts.params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (opts?.auth && API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  if (opts?.idempotencyKey) headers['X-Idempotency-Key'] = opts.idempotencyKey;
  else if (opts?.idempotency) headers['X-Idempotency-Key'] = `${opts.idempotency}:${randomId()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Orchestra ${method} ${path} timed out: network request failed`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403 && text.includes('origin_required')) throw new OrchestraOriginError();
    if (opts?.auth && (res.status === 401 || res.status === 403)) throw new OrchestraAuthError(res.status);
    throw new Error(`Orchestra ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getRoutes(): Promise<OrchestraRoute[]> {
  const res = await request<{ routes: OrchestraRoute[] } | OrchestraRoute[]>('GET', '/v1/orchestration/routes');
  return Array.isArray(res) ? res : res.routes ?? [];
}

export async function getEstimate(params: EstimateParams): Promise<OrchestraEstimate> {
  const query: Record<string, string> = {
    sourceChain: params.sourceChain,
    sourceAsset: params.sourceAsset,
    destinationChain: params.destinationChain,
    destinationAsset: params.destinationAsset,
    amount: params.amount,
  };
  if (params.amountMode) query.amountMode = params.amountMode;
  if (params.targetAmountOut) query.targetAmountOut = params.targetAmountOut;
  return request<OrchestraEstimate>('GET', '/v1/orchestration/estimate', { params: query });
}

/** A quote with its deposit address. Lives about 30 minutes. */
export async function createQuote(params: CreateQuoteParams): Promise<OrchestraQuote> {
  const body: Record<string, unknown> = {
    sourceChain: params.sourceChain,
    sourceAsset: params.sourceAsset,
    destinationChain: params.destinationChain,
    destinationAsset: params.destinationAsset,
    amount: params.amount,
    recipientAddress: params.recipientAddress,
    slippageBps: params.slippageBps ?? 100,
  };
  if (params.amountMode) body.amountMode = params.amountMode;
  if (params.targetAmountOut) body.targetAmountOut = params.targetAmountOut;
  return request<OrchestraQuote>('POST', '/v1/orchestration/quote', {
    body,
    auth: true,
    idempotency: 'quote:create',
  });
}

/**
 * Turn a funded quote into an order. Fails until the deposit is seen, so the
 * bridge polls it to detect the deposit. Keep the returned `readToken`.
 *
 * A submit carrying a payment proof is one operation however often it is
 * retried, so it reuses one key. A bare poll gets a fresh key each time: a
 * cached "not funded yet" reply would otherwise hide the deposit.
 */
export async function submitOrder(params: SubmitOrderParams): Promise<SubmittedOrder> {
  const proof = params.sparkTxHash ?? params.txHash ?? params.bitcoinTxid;
  return request<SubmittedOrder>('POST', '/v1/orchestration/submit', {
    body: params,
    auth: true,
    idempotency: 'submit',
    idempotencyKey: proof ? `submit:${params.quoteId}:${proof}` : undefined,
  });
}

export async function getStatus(query: {
  id?: string;
  quoteId?: string;
  txHash?: string;
  readToken?: string;
}): Promise<OrchestraOrder> {
  const params: Record<string, string> = {};
  if (query.id) params.id = query.id;
  else if (query.quoteId) params.quoteId = query.quoteId;
  else if (query.txHash) params.txHash = query.txHash;
  if (query.readToken) params.readToken = query.readToken;
  const raw = await request<OrchestraOrder | OrchestraOrderLookup>('GET', '/v1/orchestration/status', {
    params,
    auth: true,
  });
  // The live API wraps the order as { order, stages }; older responses were flat.
  if (raw && typeof raw === 'object' && 'order' in raw && raw.order) {
    return raw.stages ? { ...raw.order, stages: raw.stages } : raw.order;
  }
  return raw as OrchestraOrder;
}
