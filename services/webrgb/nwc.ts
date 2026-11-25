/* eslint-disable @typescript-eslint/no-require-imports -- Load the RGB engine and Nostr relay only for an active grant. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Event, SimplePool } from 'nostr-tools';
import { displayName, invoke, methodName, mutatesWallet, parseAuthorization, unixTime, type Authorization } from './nwcProtocol';

export interface WebRgbReview {
  kind: 'connect' | 'request'; name: string; url: string; details: string[]; signal: AbortSignal;
}
type Binding = ReturnType<typeof import('./account').currentWebRgbAccount>;
type Saved = Authorization & { secret: string };
type Reviewer = (review: WebRgbReview) => Promise<boolean>;
function account(): Binding { return (require('./account') as typeof import('./account')).currentWebRgbAccount(); }
function provider() { return require('./provider') as typeof import('./provider'); }
function nostr() { return require('nostr-tools') as typeof import('nostr-tools'); }
const storageKey = (binding: Binding) => 'webrgb-nwc-' + bytesToHex(sha256(utf8ToBytes(binding.key)));
const replayKey = (pubkey: string) => 'webrgb-nwc-seen-' + pubkey;
const principal = (grant: Authorization) => 'nostr:' + grant.client;
const denied = () => Object.assign(new Error('The wallet connection is locked, expired, or disconnected.'), { code: 'NOT_ENABLED' });
const rejected = () => Object.assign(new Error('Request declined in the wallet.'), { code: 'USER_REJECTED' });
const REQUEST_SECONDS = 120;

let active: Runtime | undefined;
let revision = 0;
let pairing: AbortController | undefined;
let reviewer: Reviewer | undefined;
let error: string | null = null;
const observers = new Set<() => void>();
const notify = () => { for (const observer of observers) observer(); };
export const webRgbError = () => error;
export function onWebRgbChange(listener: () => void) { observers.add(listener); return () => { observers.delete(listener); }; }
export function setWebRgbReviewer(next: Reviewer | undefined) { reviewer = next; }

// All grant changes and replay reservations are ordered, including across a suspend/restore.
let writes = Promise.resolve();
function ordered<T>(action: () => Promise<T>): Promise<T> {
  const completed = writes.then(action);
  writes = completed.then(() => undefined, () => undefined);
  return completed;
}
function check(binding: Binding, rev: number) {
  let current: Binding;
  try { current = account(); } catch { throw denied(); }
  if (revision !== rev || current.key !== binding.key || current.account !== binding.account) throw denied();
}
class Runtime {
  readonly pool: SimplePool;
  readonly key: Uint8Array;
  readonly pubkey: string;
  readonly cipher: Uint8Array;
  readonly controller = new AbortController();
  readonly ready: Promise<void>;
  relayClosed = false;
  private readonly inflight = new Set<string>();
  private readonly invoicesByRecipient = new Map<string, string>();
  private readonly sub: { close(): void };
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(readonly binding: Binding, readonly grant: Saved, private readonly rev: number) {
    const { getPublicKey, nip44, SimplePool: Pool } = nostr();
    this.key = hexToBytes(grant.secret);
    this.pubkey = getPublicKey(this.key);
    this.cipher = nip44.v2.utils.getConversationKey(this.key, grant.client);
    this.pool = new Pool({ enableReconnect: true });
    let settled!: () => void;
    this.ready = new Promise(resolve => { settled = resolve; });
    this.controller.signal.addEventListener('abort', settled, { once: true });
    // A NIP-47 request is ephemeral. An open socket alone does not mean the
    // relay has installed our request subscription. Wait for its initial EOSE.
    this.sub = this.pool.subscribeMany(grant.relays, {
      kinds: [23194], authors: [grant.client], '#p': [this.pubkey], since: unixTime() - REQUEST_SECONDS,
    }, { onevent: event => { void this.receive(event).catch(() => undefined); }, oneose: settled,
      onclose: () => { this.relayClosed = true; settled(); }, maxWait: 8000, abort: this.controller.signal });
    this.timer = setTimeout(() => { if (active === this) invalidateWebRgb(); }, Math.max(0, grant.expires * 1000 - Date.now()));
  }

  guard() {
    check(this.binding, this.rev);
    if (active !== this || this.controller.signal.aborted || this.grant.expires <= unixTime()) throw denied();
  }

  async waitForRelay() {
    await this.ready;
    this.guard();
    if (this.relayClosed) throw new Error('Could not subscribe to the Nostr relay. Check the connection and try again.');
  }

  close() {
    this.controller.abort();
    clearTimeout(this.timer);
    this.sub.close();
    this.pool.destroy();
    this.invoicesByRecipient.clear();
    this.key.fill(0);
    this.cipher.fill(0);
  }

  async publish(kind: number, tags: string[][], content: string) {
    this.guard();
    const event = nostr().finalizeEvent({ kind, tags, content, created_at: unixTime() }, this.key);
    await Promise.any(this.pool.publish(this.grant.relays, event, { maxWait: 10000, abort: this.controller.signal }));
  }

  announce() {
    const { grant } = this;
    const tags = [['p', grant.client], ['state', grant.state], ['encryption', 'nip44_v2'], ['extensions', '08']];
    if (grant.challenge) tags.push(['proof', nostr().nip44.v2.encrypt(JSON.stringify({ challenge: grant.challenge }), this.cipher)]);
    return this.publish(13194, tags, grant.methods.join(' '));
  }

  // Reserve an event before any wallet mutation. A crash after execution but before
  // the response must never allow a second transfer when the relay redelivers it.
  private reserve(id: string, expires: number) {
    return ordered(async () => {
      this.guard();
      const key = replayKey(this.pubkey);
      const raw = await AsyncStorage.getItem(key);
      const entries = raw === null ? [] : JSON.parse(raw) as [string, number][];
      if (!Array.isArray(entries) || !entries.every(e => Array.isArray(e) && /^[a-f0-9]{64}$/.test(e[0]) && Number.isSafeInteger(e[1]))) throw denied();
      const live = entries.filter(([, until]) => until > unixTime());
      if (live.some(([seen]) => id === seen)) return false;
      if (live.length >= 512) throw Object.assign(new Error('Too many active requests.'), { code: 'RATE_LIMITED' });
      this.guard();
      await AsyncStorage.setItem(key, JSON.stringify([...live, [id, expires]]));
      return true;
    });
  }

  private async receive(event: Event) {
    this.guard();
    const now = unixTime();
    if (event.kind !== 23194 || event.pubkey !== this.grant.client || !Number.isSafeInteger(event.created_at) ||
        event.created_at < now - REQUEST_SECONDS || event.created_at > now + 15 || typeof event.content !== 'string' ||
        event.content.length > 95000 || !Array.isArray(event.tags) || event.tags.length > 16) return;
    const tag = (name: string) => {
      const found = event.tags.filter(t => t[0] === name);
      return found.length === 1 && found[0].length === 2 ? found[0][1] : undefined;
    };
    const deadline = tag('expiration');
    const expires = Number(deadline);
    if (tag('p') !== this.pubkey || tag('encryption') !== 'nip44_v2' || !/^\d+$/.test(deadline ?? '') ||
        !Number.isSafeInteger(expires) || expires <= now || expires > Math.min(now, event.created_at) + REQUEST_SECONDS ||
        !nostr().verifyEvent(event) || this.inflight.has(event.id) || this.inflight.size >= 24) return;
    this.inflight.add(event.id);
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, Math.max(0, expires * 1000 - Date.now()));
    const guard = () => { this.guard(); if (controller.signal.aborted || expires <= unixTime()) throw denied(); };
    try {
      const { nip44 } = nostr();
      const request = JSON.parse(nip44.v2.decrypt(event.content, this.cipher));
      if (!request || typeof request.method !== 'string' || !/^[a-z0-9_]{1,64}$/.test(request.method)) return;
      const method = request.method as string;
      let response: object;
      try {
        guard();
        if (!this.grant.methods.includes(method)) throw Object.assign(new Error('Method outside grant.'), { code: 'NOT_ENABLED' });
        const params = request.params;
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw Object.assign(new Error('Invalid parameters.'), { code: 'INVALID_PARAMS' });
        let result: unknown;
        if (method === 'get_info') {
          const rgbNetwork = this.binding.account.network;
          const nip47Networks: Record<string, string> = { mutinynet: 'signet', testnet4: 'testnet', bitcoin: 'mainnet' };
          result = { alias: 'KaleidoSwap Wallet', network: nip47Networks[rgbNetwork] ?? rgbNetwork,
            rgb_network: rgbNetwork, methods: this.grant.methods, extensions: ['08'] };
        } else {
          const service = provider();
          const offered = service.webRgbMethods(this.binding.account);
          const rgb = offered.find(m => methodName(m) === method);
          if (!rgb) throw Object.assign(new Error('Unavailable RGB method.'), { code: 'METHOD_NOT_SUPPORTED' });
          if (mutatesWallet(rgb) && !await this.reserve(event.id, expires)) return;
          guard();
          const context = { network: this.binding.account.network, origin: principal(this.grant), assertAuthorized: guard, requestSignal: controller.signal };
          const backend = service.createWebRgbProvider(this.binding.account, context, async detail => {
            guard();
            if (!await reviewer?.({ kind: 'request', name: this.grant.name, url: principal(this.grant),
              details: [detail, this.binding.account.network, displayName(this.binding.walletName)].filter(Boolean), signal: controller.signal })) throw rejected();
            guard();
          }, guard, this.invoicesByRecipient);
          result = await invoke(backend, rgb, params);
          if (rgb === 'getInfo') {
            result = { value: { ready: true, network: context.network, protocol: 'RGB_L1',
              methods: offered.filter(m => this.grant.methods.includes(methodName(m))) } };
          }
        }
        response = { result_type: method, result, error: null };
      } catch (failure) {
        const codes: Record<string, string> = { NOT_ENABLED: 'RESTRICTED', USER_REJECTED: 'RESTRICTED', METHOD_NOT_SUPPORTED: 'NOT_IMPLEMENTED',
          INVALID_PARAMS: 'OTHER', ASSET_NOT_FOUND: 'NOT_FOUND', NO_AVAILABLE_UTXOS: 'OTHER', RATE_LIMITED: 'RATE_LIMITED' };
        const code = (failure as { code?: string } | null)?.code;
        response = { result_type: method, result: null, error: { code: (code && codes[code]) || 'INTERNAL',
          message: code && Object.prototype.hasOwnProperty.call(codes, code) && failure instanceof Error ? failure.message : 'The wallet could not complete the request.' } };
      }
      guard();
      await this.publish(23195, [['p', this.grant.client], ['e', event.id], ['encryption', 'nip44_v2']], nip44.v2.encrypt(JSON.stringify(response), this.cipher));
    } finally {
      clearTimeout(timeout);
      this.controller.signal.removeEventListener('abort', abort);
      this.inflight.delete(event.id);
    }
  }
}

export function webRgbSessions() {
  if (!active) return [];
  try { active.guard(); } catch { return []; }
  return [{ topic: active.grant.client, name: active.grant.name, url: principal(active.grant) }];
}
export function invalidateWebRgb() {
  revision++;
  pairing?.abort();
  pairing = undefined;
  active?.close();
  active = undefined;
  error = null;
  notify();
}

// Only read protected storage for the selected local RGB account. A fresh install stays offline.
async function restore(binding: Binding, rev: number) {
  check(binding, rev);
  if (active) {
    try { active.guard(); if (!active.relayClosed) return active; } catch { /* Reopen the selected binding below. */ }
    active.close(); active = undefined;
  }
  const key = storageKey(binding);
  const raw = await SecureStore.getItemAsync(key);
  check(binding, rev);
  if (!raw) return;
  const saved: Saved = JSON.parse(raw);
  if (!Number.isSafeInteger(saved.expires)) throw new Error('Could not read the saved RGB connection.');
  if (saved.expires <= unixTime()) {
    await SecureStore.deleteItemAsync(key);
    await AsyncStorage.removeItem(replayKey(nostr().getPublicKey(hexToBytes(saved.secret)))).catch(() => undefined);
    return;
  }
  active = new Runtime(binding, saved, rev);
  notify();
  return active;
}

export async function restoreWebRgb() {
  let binding: Binding;
  try { binding = account(); } catch { return; }
  const rev = revision;
  try {
    const host = await ordered(() => restore(binding, rev));
    await host?.waitForRelay();
    if (rev === revision && error) { error = null; notify(); }
  }
  catch { if (rev === revision) { error = 'Could not restore the RGB connection.'; notify(); } }
}

export async function pairWebRgb(uri: string) {
  const binding = account();
  if (pairing) throw new Error('Another RGB connection is being reviewed.');
  const request = parseAuthorization(uri, binding.account.network, provider().webRgbMethods(binding.account));
  const rev = revision;
  const controller = new AbortController();
  pairing = controller;
  const deadline = setTimeout(() => controller.abort(), Math.max(0, request.expires * 1000 - Date.now()));
  const guard = () => { check(binding, rev); if (controller.signal.aborted || request.expires <= unixTime()) throw denied(); };
  try {
    let host = await ordered(() => restore(binding, rev)).catch(() => {
      guard(); throw new Error('Could not open the saved RGB connection. Check the wallet and try again.');
    });
    guard();
    if (host && (host.grant.client !== request.client || host.grant.state !== request.state)) {
      throw new Error('Disconnect the current RGB app in Settings before connecting another.');
    }
    if (!host) {
      const name = displayName(binding.walletName);
      if (!await reviewer?.({ kind: 'connect', name: request.name, url: principal(request), signal: controller.signal,
        details: [binding.account.network, ...(name ? [name] : []), ...request.methods,
          'Relays: ' + request.relays.join(', '), 'Expires: ' + new Date(request.expires * 1000).toLocaleString()] })) throw rejected();
      guard();
      host = await ordered(async () => {
        guard();
        const { generateSecretKey, nip44 } = nostr();
        const key = generateSecretKey();
        try { nip44.v2.utils.getConversationKey(key, request.client); } catch { throw new Error('Invalid Nostr client public key.'); }
        const grant = { ...request, secret: bytesToHex(key) };
        const storage = storageKey(binding);
        try { await SecureStore.setItemAsync(storage, JSON.stringify(grant), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
        catch { throw new Error('Could not securely save the RGB connection.'); }
        try { guard(); active = new Runtime(binding, grant, rev); }
        catch (reason) { await SecureStore.deleteItemAsync(storage); throw reason; }
        error = null;
        notify();
        return active;
      });
    }
    guard();
    await host.waitForRelay();
    try { await host.announce(); }
    catch { throw new Error('The Nostr relay could not confirm pairing. Check the connection and scan the same QR again.'); }
    guard();
  } finally {
    clearTimeout(deadline);
    if (pairing === controller) pairing = undefined;
  }
}

export async function disconnectWebRgb(topic: string) {
  const binding = account();
  if (active?.grant.client !== topic || active.binding.key !== binding.key) return;
  const pubkey = active.pubkey;
  invalidateWebRgb();
  await ordered(async () => {
    try { await SecureStore.deleteItemAsync(storageKey(binding)); }
    catch { throw new Error('Could not save the disconnection. Reopen Settings and try again.'); }
    await AsyncStorage.removeItem(replayKey(pubkey)).catch(() => undefined);
  });
}
