/**
 * Receive › Deposit from another chain (Flashnet Orchestra → Spark): the flow's
 * state machine, route helpers, amount validation and the persisted session
 * that lets a user leave the screen and come back to the same deposit address
 * or order. The server stays the source of truth for order status.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  OrchestraOrder,
  OrchestraOrderStatus,
  OrchestraQuote,
  OrchestraRoute,
} from '../services/orchestra/client';
import { ORCHESTRA_AUTH_ERROR_CODE } from '../services/orchestra/client';
import { TERMINAL_STATUSES, toFixedDecimalUnits } from './orchestra-ui';

export type BridgeStep = 'select' | 'deposit' | 'tracking';

export const BRIDGE_DEST_ASSETS = ['BTC', 'USDB'] as const;
export type BridgeDestAsset = (typeof BRIDGE_DEST_ASSETS)[number];

export interface BridgeState {
  step: BridgeStep;
  sourceChain: string;
  sourceAsset: string;
  destAsset: BridgeDestAsset;
  amount: string;
  quote: OrchestraQuote | null;
  order: OrchestraOrder | null;
  /** Captured from the route when the quote is created, so a restore doesn't depend on live routes. */
  sourceDecimals?: number;
  destDecimals?: number;
}

export interface BridgeSession extends BridgeState {
  savedAt: number;
}

export const initialBridgeState: BridgeState = {
  step: 'select',
  sourceChain: '',
  sourceAsset: '',
  destAsset: 'BTC',
  amount: '',
  quote: null,
  order: null,
};

export type BridgeAction =
  | { type: 'restore'; session: BridgeState }
  | { type: 'selectSource'; chain: string; asset: string }
  | { type: 'selectDest'; asset: BridgeDestAsset }
  | { type: 'setAmount'; amount: string }
  | { type: 'quoteCreated'; quote: OrchestraQuote; sourceDecimals: number; destDecimals: number }
  | { type: 'orderDetected'; order: OrchestraOrder }
  | { type: 'orderUpdated'; update: Partial<OrchestraOrder> }
  | { type: 'backToSelect' }
  | { type: 'startOver' };

export function normalizeOrderStatus(status: unknown, fallback: OrchestraOrderStatus): OrchestraOrderStatus {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  return s ? (s as OrchestraOrderStatus) : fallback;
}

export function bridgeReducer(state: BridgeState, action: BridgeAction): BridgeState {
  switch (action.type) {
    case 'restore':
      return { ...action.session };
    case 'selectSource':
      if (state.step !== 'select') return state;
      return { ...state, sourceChain: action.chain, sourceAsset: action.asset };
    case 'selectDest':
      if (state.step !== 'select') return state;
      return { ...state, destAsset: action.asset };
    case 'setAmount':
      if (state.step !== 'select') return state;
      return { ...state, amount: sanitizeAmountInput(action.amount) };
    case 'quoteCreated':
      // A fresh quote (first one, or a re-quote after expiry) never replaces a detected order.
      if (state.step === 'tracking') return state;
      return {
        ...state,
        step: 'deposit',
        quote: action.quote,
        order: null,
        sourceDecimals: action.sourceDecimals,
        destDecimals: action.destDecimals,
      };
    case 'orderDetected':
      // The auto-detect poll and a pasted tx hash can both succeed; the first wins.
      if (state.step !== 'deposit' || !state.quote) return state;
      return {
        ...state,
        step: 'tracking',
        order: { ...action.order, status: normalizeOrderStatus(action.order.status, 'processing') },
      };
    case 'orderUpdated': {
      if (state.step !== 'tracking' || !state.order) return state;
      if (TERMINAL_STATUSES.has(state.order.status)) return state;
      const status = normalizeOrderStatus(action.update.status, state.order.status);
      // Keep the id and read token we were issued; a status body may omit them.
      return {
        ...state,
        order: {
          ...state.order,
          ...action.update,
          id: state.order.id,
          readToken: state.order.readToken ?? action.update.readToken,
          status,
        },
      };
    }
    case 'backToSelect':
      if (state.step !== 'deposit') return state;
      return { ...state, step: 'select', quote: null, order: null };
    case 'startOver':
      return {
        ...initialBridgeState,
        sourceChain: state.sourceChain,
        sourceAsset: state.sourceAsset,
        destAsset: state.destAsset,
      };
    default:
      return state;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

const lower = (s: string | undefined) => (s ?? '').toLowerCase();
const upper = (s: string | undefined) => (s ?? '').toUpperCase();

/** Routes that deliver BTC or USDB to Spark. */
export function sparkRoutes(routes: OrchestraRoute[]): OrchestraRoute[] {
  return routes.filter(
    (r) =>
      lower(r.destinationChain) === 'spark' &&
      (BRIDGE_DEST_ASSETS as readonly string[]).includes(upper(r.destinationAsset)) &&
      !!r.sourceChain &&
      !!r.sourceAsset &&
      lower(r.sourceChain) !== 'spark',
  );
}

const unique = (values: string[]) => Array.from(new Set(values));

/** Source chains in a stable order: the familiar stablecoin chains first, then A–Z. */
const CHAIN_ORDER = ['ethereum', 'tron', 'solana', 'base', 'arbitrum', 'polygon', 'optimism'];

export function sourceChains(routes: OrchestraRoute[]): string[] {
  const rank = (c: string) => {
    const i = CHAIN_ORDER.indexOf(lower(c));
    return i === -1 ? CHAIN_ORDER.length : i;
  };
  return unique(routes.map((r) => r.sourceChain)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const ASSET_ORDER = ['USDT', 'USDC'];

export function sourceAssetsFor(routes: OrchestraRoute[], chain: string): string[] {
  const rank = (a: string) => {
    const i = ASSET_ORDER.indexOf(upper(a));
    return i === -1 ? ASSET_ORDER.length : i;
  };
  return unique(routes.filter((r) => r.sourceChain === chain).map((r) => r.sourceAsset)).sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

export function destAssetsFor(routes: OrchestraRoute[], chain: string, asset: string): BridgeDestAsset[] {
  return BRIDGE_DEST_ASSETS.filter((dest) => !!findRoute(routes, chain, asset, dest));
}

export function findRoute(
  routes: OrchestraRoute[],
  chain: string,
  asset: string,
  dest: BridgeDestAsset,
): OrchestraRoute | undefined {
  return routes.find(
    (r) => r.sourceChain === chain && r.sourceAsset === asset && upper(r.destinationAsset) === dest,
  );
}

/** USDT on Ethereum, else USDT anywhere, else the first route. */
export function defaultRoute(routes: OrchestraRoute[]): OrchestraRoute | undefined {
  return (
    routes.find((r) => upper(r.sourceAsset) === 'USDT' && lower(r.sourceChain) === 'ethereum') ??
    routes.find((r) => upper(r.sourceAsset) === 'USDT') ??
    routes[0]
  );
}

// ── Decimals ─────────────────────────────────────────────────────────────────

const validDecimals = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/**
 * The decimal scale of each leg: the snapshot saved with the quote wins (a live
 * route may change while the screen is closed), then the live route. A fresh
 * selection never guesses from the ticker.
 */
export function resolveDecimals(
  state: Pick<BridgeState, 'sourceDecimals' | 'destDecimals'>,
  route: OrchestraRoute | undefined,
): { source?: number; dest?: number } {
  return {
    source: validDecimals(state.sourceDecimals) ?? validDecimals(route?.source?.decimals),
    dest: validDecimals(state.destDecimals) ?? validDecimals(route?.destination?.decimals),
  };
}

// ── Amounts ──────────────────────────────────────────────────────────────────

/** Keep digits and one decimal separator (a comma becomes a dot). */
export function sanitizeAmountInput(text: string): string {
  const cleaned = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

export type AmountValidation =
  | { ok: true; raw: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'zero' | 'precision' | 'unknown-precision'; message: string };

export function validateBridgeAmount(amount: string, decimals: number | undefined, ticker = ''): AmountValidation {
  const value = amount.trim();
  if (!value) return { ok: false, reason: 'empty', message: 'Enter an amount' };
  if (!/^\d*\.?\d*$/.test(value) || value === '.') {
    return { ok: false, reason: 'invalid', message: 'Enter a valid amount' };
  }
  if (decimals === undefined) {
    return { ok: false, reason: 'unknown-precision', message: 'This route is unavailable right now. Pick another one.' };
  }
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > decimals) {
    return {
      ok: false,
      reason: 'precision',
      message: `${ticker || 'This asset'} allows up to ${decimals} decimal${decimals === 1 ? '' : 's'}`,
    };
  }
  const normalized = value.startsWith('.') ? `0${value}` : value.endsWith('.') ? value.slice(0, -1) : value;
  const raw = toFixedDecimalUnits(normalized, decimals);
  if (!/^\d+$/.test(raw) || /^0+$/.test(raw)) return { ok: false, reason: 'zero', message: 'Enter an amount above zero' };
  return { ok: true, raw };
}

// ── Quote expiry ─────────────────────────────────────────────────────────────

export function quoteMsLeft(quote: Pick<OrchestraQuote, 'expiresAt'> | null, now: number): number {
  if (!quote) return 0;
  const at = Date.parse(quote.expiresAt);
  return Number.isFinite(at) ? at - now : 0;
}

export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

// ── Persistence ──────────────────────────────────────────────────────────────

export const BRIDGE_SESSION_KEY = '@bridge_session_v1';
/** Sessions older than this are treated as abandoned. */
export const BRIDGE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What to persist for a state: nothing on the select step (there's nothing in flight). */
export function sessionToPersist(state: BridgeState, now: number): BridgeSession | null {
  if (state.step === 'select') return null;
  return { ...state, savedAt: now };
}

/**
 * The state to resume from a stored value, or null. Old sessions and finished
 * orders are dropped; an expired quote with no order comes back as a filled-in
 * selection, never as a stale deposit address.
 */
export function restoreSession(value: unknown, now: number): BridgeState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<BridgeSession>;
  if (
    !v.step ||
    !['select', 'deposit', 'tracking'].includes(v.step) ||
    typeof v.sourceChain !== 'string' ||
    typeof v.sourceAsset !== 'string' ||
    !(BRIDGE_DEST_ASSETS as readonly string[]).includes(v.destAsset as string)
  ) {
    return null;
  }
  if (typeof v.savedAt !== 'number' || now - v.savedAt > BRIDGE_SESSION_MAX_AGE_MS) return null;

  const state: BridgeState = {
    step: v.step,
    sourceChain: v.sourceChain,
    sourceAsset: v.sourceAsset,
    destAsset: v.destAsset as BridgeDestAsset,
    amount: typeof v.amount === 'string' ? v.amount : '',
    quote: v.quote ?? null,
    order: v.order ?? null,
    sourceDecimals: validDecimals(v.sourceDecimals),
    destDecimals: validDecimals(v.destDecimals),
  };

  if (state.step === 'tracking') {
    if (!state.order?.id) return null;
    if (TERMINAL_STATUSES.has(normalizeOrderStatus(state.order.status, 'processing'))) return null;
    return state;
  }
  if (state.step === 'deposit') {
    if (!state.quote?.quoteId || !state.quote.depositAddress) return null;
    if (quoteMsLeft(state.quote, now) <= 0) {
      return { ...state, step: 'select', quote: null, order: null };
    }
    return state;
  }
  return null;
}

export async function loadBridgeSession(now = Date.now()): Promise<BridgeState | null> {
  try {
    const raw = await AsyncStorage.getItem(BRIDGE_SESSION_KEY);
    if (!raw) return null;
    const restored = restoreSession(JSON.parse(raw), now);
    if (!restored || restored.step === 'select') await AsyncStorage.removeItem(BRIDGE_SESSION_KEY);
    return restored;
  } catch {
    return null;
  }
}

export async function saveBridgeSession(state: BridgeState, now = Date.now()): Promise<void> {
  try {
    const session = sessionToPersist(state, now);
    if (session) await AsyncStorage.setItem(BRIDGE_SESSION_KEY, JSON.stringify(session));
    else await AsyncStorage.removeItem(BRIDGE_SESSION_KEY);
  } catch {
    // Best effort: without it the user only loses the resume.
  }
}

export async function clearBridgeSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BRIDGE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** A short, user-facing reason from an Orchestra failure. */
export function orchestraErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes(ORCHESTRA_AUTH_ERROR_CODE)) return "Cross-chain deposits aren't available right now. Try again later.";
  if (/network request failed|failed to fetch/i.test(msg)) return 'No connection. Check your internet and try again.';
  const body = /failed \(\d+\): ([\s\S]*)$/.exec(msg)?.[1]?.trim();
  if (!body) return fallback;
  try {
    const json = JSON.parse(body);
    const reason = json?.message ?? json?.error?.message ?? json?.error;
    return typeof reason === 'string' && reason.trim() ? reason.trim() : fallback;
  } catch {
    return body.length <= 160 && !/[<{]/.test(body) ? body : fallback;
  }
}
