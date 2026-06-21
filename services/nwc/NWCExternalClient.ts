/**
 * Nostr Wallet Connect (NIP-47) CLIENT.
 *
 * This is the *client* side — it connects this app to an external NWC wallet
 * service (e.g. the KaleidoSwap desktop hub) via a `nostr+walletconnect://`
 * string. It is distinct from `services/NWCService.ts`, which is the *server*
 * (this app acting as a wallet for others).
 *
 * Vendored from `kaleido-sdk/nwc` until that SDK version is published; keep the
 * two in sync. Requests are NIP-04 encrypted (kind 23194); responses are
 * correlated as kind 23195 over relays. Relies on the global `WebSocket` and
 * the `react-native-get-random-values` polyfill loaded at app entry.
 */

import {
  SimplePool,
  finalizeEvent,
  getPublicKey,
  nip04,
  nip44,
  type Event,
  type Filter,
} from 'nostr-tools';

const NWC_KIND_REQUEST = 23194;
const NWC_KIND_RESPONSE = 23195;
const DEFAULT_TIMEOUT_MS = 60_000;
const URI_SCHEME = 'nostr+walletconnect://';

export type NwcMethod =
  | 'get_info'
  | 'get_balance'
  | 'make_invoice'
  | 'pay_invoice'
  | 'pay_keysend'
  | 'lookup_invoice'
  | 'list_transactions'
  // KaleidoSwap RLN extensions (raw rgb-lightning-node responses)
  | 'rln_node_info'
  | 'rln_list_assets'
  | 'rln_asset_balance'
  | 'rln_rgb_invoice'
  | 'rln_ln_invoice'
  | 'rln_decode_rgb_invoice'
  | 'rln_send_asset'
  | 'rln_list_channels'
  | 'rln_get_address'
  | 'rln_decode_ln_invoice'
  | 'rln_send_btc'
  | 'rln_list_payments';

export interface NwcConnectionInfo {
  walletPubkey: string;
  relays: string[];
  secret: string;
  lud16?: string;
}

export interface NwcGetInfoResult {
  alias?: string;
  pubkey?: string;
  network?: string;
  block_height?: number;
  methods: string[];
}

export interface NwcGetBalanceResult {
  balance: number;
}

export interface NwcInvoice {
  type?: 'incoming' | 'outgoing';
  state?: 'pending' | 'settled' | 'expired' | 'failed';
  invoice?: string;
  preimage?: string;
  payment_hash?: string;
  amount?: number;
  fees_paid?: number;
  created_at?: number;
}

export interface NwcPayInvoiceResult {
  preimage: string;
  fees_paid?: number;
}

export class NwcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NwcError';
    this.code = code;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function parseNwcUri(uri: string): NwcConnectionInfo {
  const trimmed = uri.trim();
  if (!trimmed.startsWith(URI_SCHEME)) {
    throw new Error('Invalid NWC URI: missing nostr+walletconnect:// scheme');
  }
  const withoutScheme = trimmed.slice(URI_SCHEME.length);
  const queryIndex = withoutScheme.indexOf('?');
  if (queryIndex === -1) throw new Error('Invalid NWC URI: missing query parameters');
  const walletPubkey = withoutScheme.slice(0, queryIndex).toLowerCase();
  const params = new URLSearchParams(withoutScheme.slice(queryIndex + 1));
  const relays = params.getAll('relay').filter(Boolean);
  const secret = params.get('secret') ?? '';
  const lud16 = params.get('lud16') ?? undefined;
  if (!walletPubkey) throw new Error('Invalid NWC URI: missing wallet pubkey');
  if (relays.length === 0) throw new Error('Invalid NWC URI: missing relay');
  if (!secret) throw new Error('Invalid NWC URI: missing secret');
  return { walletPubkey, relays, secret, lud16 };
}

export class NWCClient {
  private readonly pool: SimplePool;
  private readonly walletPubkey: string;
  private readonly relays: string[];
  private readonly secretBytes: Uint8Array;
  readonly clientPubkey: string;
  private readonly timeoutMs: number;
  private readonly encryption: 'nip44' | 'nip04';
  private readonly convKey: Uint8Array;

  constructor(
    uri: string,
    options: { timeoutMs?: number; encryption?: 'nip44' | 'nip04' } = {},
  ) {
    const info = parseNwcUri(uri);
    this.walletPubkey = info.walletPubkey;
    this.relays = info.relays;
    this.secretBytes = hexToBytes(info.secret);
    this.clientPubkey = getPublicKey(this.secretBytes);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.encryption = options.encryption ?? 'nip44';
    this.convKey = nip44.getConversationKey(this.secretBytes, this.walletPubkey);
    this.pool = new SimplePool();
  }

  private encryptContent(plaintext: string): string {
    return this.encryption === 'nip44'
      ? nip44.encrypt(plaintext, this.convKey)
      : nip04.encrypt(this.secretBytes, this.walletPubkey, plaintext);
  }

  /** Decrypt a response, detecting the scheme (NIP-04 carries a `?iv=` marker). */
  private decryptContent(payload: string): string {
    return payload.includes('?iv=')
      ? nip04.decrypt(this.secretBytes, this.walletPubkey, payload)
      : nip44.decrypt(payload, this.convKey);
  }

  async request<T>(
    method: NwcMethod,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const { signal } = options;
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new NwcError('CANCELLED', `NWC request '${method}' was cancelled`);
    }

    // Yield before the synchronous NIP-44 encryption/signing burst so a queued
    // navigation or cancellation event can run first.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new NwcError('CANCELLED', `NWC request '${method}' was cancelled`);
    }

    const content = this.encryptContent(JSON.stringify({ method, params }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new NwcError('CANCELLED', `NWC request '${method}' was cancelled`);
    }
    const reqEvent = finalizeEvent(
      {
        kind: NWC_KIND_REQUEST,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.walletPubkey]],
        content,
      },
      this.secretBytes,
    );
    const filter: Filter = {
      kinds: [NWC_KIND_RESPONSE],
      authors: [this.walletPubkey],
      '#e': [reqEvent.id],
    };

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        sub.close();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new NwcError('CANCELLED', `NWC request '${method}' was cancelled`),
        );
      };
      const sub = this.pool.subscribeMany(this.relays, filter, {
        onevent: (event: Event) => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            const decrypted = this.decryptContent(event.content);
            const response = JSON.parse(decrypted) as {
              error?: { code: string; message: string } | null;
              result?: T;
            };
            if (response.error) {
              reject(new NwcError(response.error.code, response.error.message));
            } else {
              resolve(response.result as T);
            }
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new NwcError('OTHER', `NWC request '${method}' timed out`));
      }, this.timeoutMs);

      // Fire the request to every relay; per-relay failures are swallowed (the
      // response — or the timeout — drives resolution).
      for (const pub of this.pool.publish(this.relays, reqEvent)) {
        pub.catch(() => undefined);
      }
    });
  }

  getInfo(signal?: AbortSignal): Promise<NwcGetInfoResult> {
    return this.request<NwcGetInfoResult>('get_info', {}, { signal });
  }

  getBalance(signal?: AbortSignal): Promise<NwcGetBalanceResult> {
    return this.request<NwcGetBalanceResult>('get_balance', {}, { signal });
  }

  makeInvoice(
    params: { amount: number; description?: string; expiry?: number },
    signal?: AbortSignal,
  ): Promise<NwcInvoice> {
    return this.request<NwcInvoice>('make_invoice', { ...params }, { signal });
  }

  payInvoice(params: { invoice: string; amount?: number }): Promise<NwcPayInvoiceResult> {
    return this.request<NwcPayInvoiceResult>('pay_invoice', { ...params });
  }

  lookupInvoice(
    params: { payment_hash?: string; invoice?: string },
    signal?: AbortSignal,
  ): Promise<NwcInvoice> {
    return this.request<NwcInvoice>('lookup_invoice', { ...params }, { signal });
  }

  async listTransactions(params: Record<string, unknown> = {}): Promise<NwcInvoice[]> {
    const result = await this.request<{ transactions: NwcInvoice[] }>(
      'list_transactions',
      params,
    );
    return result?.transactions ?? [];
  }

  // --- KaleidoSwap RLN extensions (rln_*) — raw rgb-lightning-node responses ---

  rlnNodeInfo(): Promise<unknown> {
    return this.request<unknown>('rln_node_info', {});
  }
  rlnListAssets(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request<unknown>('rln_list_assets', params);
  }
  rlnAssetBalance(params: { asset_id: string }, signal?: AbortSignal): Promise<unknown> {
    return this.request<unknown>('rln_asset_balance', params, { signal });
  }
  rlnRgbInvoice(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.request<unknown>('rln_rgb_invoice', params, { signal });
  }
  /** Lightning invoice; pass asset_id + asset_amount for an RGB-over-LN invoice. */
  rlnLnInvoice(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.request<unknown>('rln_ln_invoice', params, { signal });
  }
  rlnDecodeRgbInvoice(params: { invoice: string }): Promise<unknown> {
    return this.request<unknown>('rln_decode_rgb_invoice', params);
  }
  rlnSendAsset(params: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>('rln_send_asset', params);
  }
  rlnListChannels(signal?: AbortSignal): Promise<unknown> {
    return this.request<unknown>('rln_list_channels', {}, { signal });
  }
  rlnGetAddress(signal?: AbortSignal): Promise<unknown> {
    return this.request<unknown>('rln_get_address', {}, { signal });
  }

  close(): void {
    this.pool.close(this.relays);
  }
}
