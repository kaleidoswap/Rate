// Desktop model: run KaleidoMind's inference on the model the paired desktop
// serves over its OpenAI-compatible API. Only the model runs there; tools,
// skills and the confirmation gate stay on the phone.
import * as SecureStore from 'expo-secure-store';
import type { LLMProvider, TurnInput, TurnOutput } from '@kaleidorg/mind';

export interface DesktopPairing {
  host: string;
  port: number;
  token: string;
  /** Display name of the desktop's model from the QR, if any. */
  model?: string;
  /** Display name of the desktop app from the QR, if any. */
  name?: string;
}

export const PAIRING_TYPE = 'kaleido-mind-remote';
export const DEFAULT_DESKTOP_PORT = 47615;
const STORE_KEY = 'mind_desktop_pairing';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const TOKEN_RE = /^[A-Za-z0-9_\-.~+/=]{16,512}$/;
const HOSTNAME_RE = /^(localhost|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.local)$/i;

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** Loopback, RFC 1918 and link-local IPv4, `localhost` or an mDNS `.local` name. */
export function isLocalHost(host: string): boolean {
  const ip = parseIPv4(host);
  if (!ip) return HOSTNAME_RE.test(host);
  const [a, b] = ip;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export class PairingError extends Error {}

/** Validate host, port and token; never echoes the token in an error. */
export function validatePairing(input: {
  host: unknown;
  port: unknown;
  token: unknown;
  model?: unknown;
  name?: unknown;
}): DesktopPairing {
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  if (!host) throw new PairingError('The desktop address is missing.');
  if (!isLocalHost(host)) {
    throw new PairingError('The desktop address must be on your local network (for example 192.168.1.20).');
  }
  const port = typeof input.port === 'string' ? Number(input.port.trim()) : input.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PairingError('The port must be a number between 1 and 65535.');
  }
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!TOKEN_RE.test(token)) throw new PairingError('The pairing token is missing or malformed.');
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  return { host, port, token, model: text(input.model), name: text(input.name) };
}

/** Parse the desktop's pairing QR (`{"type":"kaleido-mind-remote","v":1,…}`). */
export function parsePairingPayload(raw: string): DesktopPairing {
  let data: any;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    throw new PairingError('This QR code is not a KaleidoSwap desktop pairing code.');
  }
  if (!data || typeof data !== 'object' || data.type !== PAIRING_TYPE) {
    throw new PairingError('This QR code is not a KaleidoSwap desktop pairing code.');
  }
  if (data.v !== 1) throw new PairingError('This pairing code needs a newer version of the app.');
  if (data.tls === true) throw new PairingError('Encrypted pairing is not supported by this version of the app.');
  return validatePairing(data);
}

export function isPairingPayload(raw: string): boolean {
  const s = raw.trim();
  return s.startsWith('{') && s.includes(PAIRING_TYPE);
}

export function baseUrlFor(p: Pick<DesktopPairing, 'host' | 'port'>): string {
  return `http://${p.host}:${p.port}/v1`;
}

// ── Secure storage ────────────────────────────────────────────────────────

let cached: DesktopPairing | null | undefined;

export async function loadPairing(): Promise<DesktopPairing | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY, STORE_OPTIONS);
    cached = raw ? validatePairing(JSON.parse(raw)) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function getCachedPairing(): DesktopPairing | null {
  return cached ?? null;
}

export async function savePairing(p: DesktopPairing): Promise<void> {
  const valid = validatePairing(p);
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(valid), STORE_OPTIONS);
  cached = valid;
  resetHealth();
}

export async function forgetPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY, STORE_OPTIONS);
  cached = null;
  resetHealth();
  setStatus({ state: 'off' });
}

// ── Health check ──────────────────────────────────────────────────────────

export type HealthFailure = 'unauthorized' | 'unreachable' | 'timeout' | 'no_model' | 'bad_response';
export type HealthResult = { ok: true; modelId: string } | { ok: false; reason: HealthFailure };

/** GET /v1/models with a short timeout. Resolves, never throws. */
export async function checkDesktopHealth(
  p: DesktopPairing,
  opts: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<HealthResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 2500);
  try {
    const res = await doFetch(`${baseUrlFor(p)}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${p.token}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' };
    if (res.status === 503) return { ok: false, reason: 'no_model' };
    if (!res.ok) return { ok: false, reason: 'bad_response' };
    const json: any = await res.json().catch(() => null);
    const id = Array.isArray(json?.data) ? json.data.find((m: any) => typeof m?.id === 'string')?.id : undefined;
    return id ? { ok: true, modelId: id } : { ok: false, reason: 'no_model' };
  } catch {
    return { ok: false, reason: timedOut ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export function describeHealthFailure(reason: HealthFailure): string {
  switch (reason) {
    case 'unauthorized':
      return 'The desktop rejected the pairing token. Scan its QR code again.';
    case 'no_model':
      return 'No model is running on the desktop.';
    case 'timeout':
    case 'unreachable':
      return 'The desktop is not reachable on this network.';
    default:
      return 'The desktop sent an unexpected response.';
  }
}

// ── Status (for the chat header and settings) ─────────────────────────────

export type DesktopStatus =
  | { state: 'off' }
  | { state: 'checking' }
  | { state: 'connected'; modelId: string }
  | { state: 'fallback'; reason: HealthFailure | 'error' };

let status: DesktopStatus = { state: 'off' };
const listeners = new Set<(s: DesktopStatus) => void>();

export function getDesktopStatus(): DesktopStatus {
  return status;
}

export function subscribeDesktopStatus(fn: (s: DesktopStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setStatus(next: DesktopStatus): void {
  const same =
    next.state === status.state &&
    (next.state !== 'connected' || (status.state === 'connected' && status.modelId === next.modelId)) &&
    (next.state !== 'fallback' || (status.state === 'fallback' && status.reason === next.reason));
  status = next;
  if (!same) listeners.forEach((fn) => fn(next));
}

let health: { at: number; result: HealthResult } | null = null;
let inflightHealth: Promise<HealthResult> | null = null;
const OK_TTL_MS = 60_000;
const FAIL_TTL_MS = 15_000;

function resetHealth(): void {
  health = null;
  inflightHealth = null;
}

/** Cached health check; `force` skips the cache. Updates the shared status. */
export async function refreshDesktopHealth(
  opts: { force?: boolean; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<HealthResult | null> {
  const p = await loadPairing();
  if (!p) {
    setStatus({ state: 'off' });
    return null;
  }
  const now = Date.now();
  if (!opts.force && health && now - health.at < (health.result.ok ? OK_TTL_MS : FAIL_TTL_MS)) {
    return health.result;
  }
  if (!inflightHealth) {
    if (status.state !== 'connected') setStatus({ state: 'checking' });
    inflightHealth = checkDesktopHealth(p, opts).then((result) => {
      health = { at: Date.now(), result };
      inflightHealth = null;
      setStatus(result.ok ? { state: 'connected', modelId: result.modelId } : { state: 'fallback', reason: result.reason });
      return result;
    });
  }
  return inflightHealth;
}

function markFailed(): void {
  health = { at: Date.now(), result: { ok: false, reason: 'unreachable' } };
  setStatus({ state: 'fallback', reason: 'error' });
}

export function setDesktopDisabled(): void {
  setStatus({ state: 'off' });
}

// ── Provider routing ──────────────────────────────────────────────────────

export type RemoteProviderFactory = (opts: { baseUrl: string; apiKey: string; model: string }) => LLMProvider;

export interface DesktopRoutingOptions {
  local: LLMProvider;
  isEnabled: () => boolean;
  createRemote: RemoteProviderFactory;
  /** Called once each time a turn falls back from the desktop to this device. */
  onFallback?: (reason: HealthFailure | 'error') => void;
  fetch?: typeof fetch;
}

/**
 * An LLMProvider that sends a turn to the paired desktop when it is enabled and
 * healthy, and otherwise (or when the desktop fails before streaming anything)
 * runs it on this device.
 */
export function createDesktopRoutingProvider(opts: DesktopRoutingOptions): LLMProvider & {
  lastRoute: () => 'desktop' | 'device';
} {
  let remote: { key: string; provider: LLMProvider } | null = null;
  let route: 'desktop' | 'device' = 'device';

  const remoteFor = (p: DesktopPairing, modelId: string): LLMProvider => {
    const key = `${p.host}:${p.port}:${modelId}:${p.token}`;
    if (!remote || remote.key !== key) {
      remote = { key, provider: opts.createRemote({ baseUrl: baseUrlFor(p), apiKey: p.token, model: modelId }) };
    }
    return remote.provider;
  };

  const runLocal = (input: TurnInput): Promise<TurnOutput> => {
    route = 'device';
    return opts.local.runTurn(input);
  };

  return {
    name: 'desktop-or-device',
    lastRoute: () => route,
    async runTurn(input: TurnInput): Promise<TurnOutput> {
      if (!opts.isEnabled()) {
        setDesktopDisabled();
        return runLocal(input);
      }
      const health = await refreshDesktopHealth({ fetch: opts.fetch });
      const p = getCachedPairing();
      if (!health || !p) return runLocal(input);
      if (!health.ok) {
        opts.onFallback?.(health.reason);
        return runLocal(input);
      }
      let streamed = false;
      const onToken = input.onToken;
      try {
        route = 'desktop';
        return await remoteFor(p, health.modelId).runTurn({
          ...input,
          onToken: (t: string) => {
            streamed = true;
            onToken?.(t);
          },
        });
      } catch (err) {
        if (input.signal?.aborted || streamed) throw err;
        markFailed();
        opts.onFallback?.('error');
        return runLocal(input);
      }
    },
    async cancel(requestId: string): Promise<void> {
      await Promise.all([remote?.provider.cancel?.(requestId), opts.local.cancel?.(requestId)]);
    },
  };
}

/** Test hook: drop in-memory state. */
export function __resetDesktopModelForTests(): void {
  cached = undefined;
  resetHealth();
  status = { state: 'off' };
  listeners.clear();
}
