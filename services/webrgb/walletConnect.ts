/* eslint-disable @typescript-eslint/no-require-imports -- Load relay SDKs only when pairing or restoring an existing session. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  WalletConnectSession, WalletConnectWallet, WalletConnectWalletClient,
} from '@utexo/webrgb-walletconnect';

export interface WalletConnectReview {
  kind: 'connect' | 'request';
  name: string;
  url: string;
  details: string[];
  verification?: 'VALID' | 'UNKNOWN';
  signal: AbortSignal;
}

type Reviewer = (review: WalletConnectReview) => Promise<boolean>;
type Binding = ReturnType<typeof import('./account').currentWebRgbAccount>;
function currentWebRgbAccount(): Binding {
  const service: typeof import('./account') = require('./account');
  return service.currentWebRgbAccount();
}
type Saved = { publicId: string; topics: string[] };
type Runtime = Binding & { adapter: WalletConnectWallet; client: WalletConnectWalletClient; saved: Saved; close(): void };

let active: Runtime | undefined;
let sdk: Promise<WalletConnectWalletClient> | undefined;
let revision = 0;
let initializing: { key: string; promise: Promise<Runtime | undefined> } | undefined;
let writing: Promise<void> = Promise.resolve();
let reviewer: Reviewer | undefined;
let lastError: string | null = null;
const listeners = new Set<() => void>();

function notify() { for (const listener of listeners) listener(); }
export const walletConnectError = () => lastError;
export function onWalletConnectChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setWalletConnectReviewer(next: Reviewer | undefined) { reviewer = next; }

// WalletKit stores relay session keys. Our record grants each topic access to exactly
// one local wallet and network and gives the dApp a stable, random public account ID.
function save(key: string, state: Saved) {
  const snapshot = JSON.stringify(state);
  const op = writing.then(() => AsyncStorage.setItem(key, snapshot));
  writing = op.catch(() => undefined);
  return op;
}

function safeName(value: string) {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 100);
}
function sessionInfo(session: WalletConnectSession) {
  return { topic: session.topic, name: safeName(session.peer.metadata.name), url: new URL(session.peer.metadata.url).origin };
}
function unavailable() {
  return Object.assign(new Error('Reopen the paired wallet to use this connection.'), { code: 'NOT_ENABLED', authorization: 'SUSPENDED' });
}

function matchingAccount(binding: Binding) {
  try {
    const current = currentWebRgbAccount();
    return current.key === binding.key && current.account === binding.account;
  } catch { return false; }
}

export function walletConnectSessions() {
  if (!active || !matchingAccount(active)) return [];
  const sessions = active.client.getActiveSessions();
  return active.saved.topics.flatMap(topic => {
    const session = sessions[topic];
    return session && session.expiry > Date.now() / 1000 ? [sessionInfo(session)] : [];
  });
}

export function invalidateWalletConnect() {
  revision++;
  active?.close();
  active = undefined;
  initializing = undefined;
  lastError = null;
  notify();
}

async function walletKit(projectId: string) {
  if (!sdk) {
    sdk = (async () => {
      const { Core }: typeof import('@walletconnect/core') = require('@walletconnect/core');
      const { WalletKit }: typeof import('@reown/walletkit') = require('@reown/walletkit');
      return WalletKit.init({ core: new Core({ projectId, telemetryEnabled: false }), metadata: {
        name: 'KaleidoSwap Wallet', description: 'Bitcoin and RGB wallet',
        url: 'https://kaleidoswap.com', icons: ['https://kaleidoswap.com/favicon.ico'],
      } });
    })().catch(() => {
      sdk = undefined;
      throw new Error('Could not start WalletConnect. Check the connection and try again.');
    });
  }
  return sdk;
}

function attach(binding: Binding, saved: Saved, client: WalletConnectWalletClient,
  createAdapter: typeof import('@utexo/webrgb-walletconnect').createWalletConnectWallet, rev: number): Runtime {
  const check = () => {
    if (rev !== revision || !matchingAccount(binding)) throw unavailable();
  };
  const requestReview = async (review: WalletConnectReview) => {
    check();
    if (review.signal.aborted || !reviewer) return false;
    const accepted = await reviewer(review);
    check();
    return accepted && !review.signal.aborted;
  };
  const { createWebRgbProvider, webRgbMethods }: typeof import('./provider') = require('./provider');
  const accountDetails = [binding.account.network, ...(binding.walletName ? [safeName(binding.walletName)] : [])];
  const adapter = createAdapter({
    client, network: binding.account.network, account: saved.publicId, methods: webRgbMethods(binding.account),
    approveSession: proposal => requestReview({
      kind: 'connect', name: safeName(proposal.name), url: proposal.origin,
      details: [...accountDetails, ...proposal.methods], verification: proposal.verification, signal: proposal.signal,
    }),
    getProvider: context => {
      const guard = () => {
        check();
        if (!saved.topics.includes(context.topic)) {
          throw Object.assign(new Error('This session is disconnected.'), { code: 'NOT_ENABLED', authorization: 'REVOKED' });
        }
        context.assertAuthorized();
      };
      guard();
      return createWebRgbProvider(binding.account, context, async detail => {
        guard();
        const session = client.getActiveSessions()[context.topic];
        if (!session) throw unavailable();
        const approved = await requestReview({ kind: 'request', name: safeName(session.peer.metadata.name), url: context.origin,
          details: [detail, ...accountDetails], signal: context.requestSignal });
        if (!approved) throw Object.assign(new Error('Request declined.'), { code: 'USER_REJECTED' });
        guard();
      }, guard);
    },
    onSessionConnected: session => {
      if (saved.topics.includes(session.topic)) return;
      saved.topics.push(session.topic);
      void save(binding.key, saved).catch(() => {
        saved.topics = saved.topics.filter(t => t !== session.topic);
        void adapter.disconnect(session.topic).catch(() => undefined);
        lastError = 'Could not save the connection. Pair again.';
        notify();
      });
      lastError = null;
      notify();
    },
    onError: error => {
      // SDK errors may include proposal metadata, request parameters or a pairing URI.
      lastError = (error as Error & { code?: string }).code === 'USER_REJECTED'
        ? 'Connection declined.'
        : 'WalletConnect could not complete the request. Check the dApp permissions and RGB network.';
      notify();
    },
  });
  const remove = ({ topic }: { topic: string }) => {
    if (!saved.topics.includes(topic)) return;
    saved.topics = saved.topics.filter(t => t !== topic);
    void save(binding.key, saved).catch(() => undefined);
    notify();
  };
  // The adapter leaves unrelated namespaces for another wallet handler. This app
  // serves WebRGB only, so close those proposals instead of leaving both UIs waiting.
  const unsupported = ({ id, params }: { id: number; params: { requiredNamespaces?: object; optionalNamespaces?: object } }) => {
    const namespaces = Object.keys({ ...params?.requiredNamespaces, ...params?.optionalNamespaces });
    if (namespaces.some(name => name === 'rgb' || name.startsWith('rgb:'))) return;
    lastError = 'This connection does not request WebRGB. Scan the RGB wallet code from the dApp.';
    notify();
    void client.rejectSession({ id, reason: { code: 5104, message: 'Unsupported namespace. This wallet serves WebRGB.' } }).catch(() => undefined);
  };
  client.on('session_proposal', unsupported);
  client.on('session_delete', remove);
  client.core.expirer.on('expirer_expired', notify);
  return { ...binding, adapter, saved, client, close() {
    client.off('session_delete', remove);
    client.off('session_proposal', unsupported);
    client.core.expirer.off('expirer_expired', notify);
    adapter.dispose();
  } };
}

async function initialize(binding: Binding, rev: number, pair: boolean) {
  await writing;
  const raw = await AsyncStorage.getItem(binding.key);
  const saved: Saved | null = raw ? JSON.parse(raw) : null;
  if (saved && (typeof saved.publicId !== 'string' || !Array.isArray(saved.topics) || !saved.topics.every(t => typeof t === 'string'))) {
    throw new Error('The saved WalletConnect session is unreadable.');
  }
  if (!pair && !saved?.topics.length) return;
  const projectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) throw new Error('WalletConnect needs a project ID configured in this build.');
  const client = await walletKit(projectId);
  const { createWalletConnectWallet }: typeof import('@utexo/webrgb-walletconnect') = require('@utexo/webrgb-walletconnect');
  if (rev !== revision || !matchingAccount(binding)) throw unavailable();
  if (saved) {
    const sessions = client.getActiveSessions();
    const live = saved.topics.filter(topic => sessions[topic]?.expiry > Date.now() / 1000);
    if (live.length !== saved.topics.length) {
      saved.topics = live;
      await save(binding.key, saved);
      if (!pair && !live.length) return;
      if (rev !== revision || !matchingAccount(binding)) throw unavailable();
    }
  }
  const { randomUUID }: typeof import('expo-crypto') = require('expo-crypto');
  active = attach(binding, saved ?? { publicId: randomUUID(), topics: [] }, client, createWalletConnectWallet, rev);
  notify();
  return active;
}

async function runtime(pair: boolean): Promise<Runtime | undefined> {
  let binding: Binding;
  try { binding = currentWebRgbAccount(); }
  catch (error) { if (pair) throw error; return; }
  if (active && matchingAccount(active)) return active;
  if (active || (initializing && initializing.key !== binding.key)) invalidateWalletConnect();
  if (initializing) {
    const ready = await initializing.promise;
    if (ready || !pair) return ready;
    // A cold-start restore with no saved sessions may race the first QR scan.
    return runtime(true);
  }
  const rev = revision;
  const promise = initialize(binding, rev, pair);
  const pending = { key: binding.key, promise };
  initializing = pending;
  try { return await promise; }
  finally { if (initializing === pending) initializing = undefined; }
}

export async function restoreWalletConnect() { await runtime(false); }

export async function pairWalletConnect(uri: string) {
  const host = await runtime(true);
  if (!host || !matchingAccount(host)) throw unavailable();
  lastError = null;
  notify();
  try { await host.adapter.pair(uri); }
  catch { throw new Error('Could not pair. Scan a fresh WalletConnect v2 code and check your connection.'); }
}

export async function disconnectWalletConnect(topic: string) {
  const host = await runtime(false);
  if (!host || !host.saved.topics.includes(topic)) return;
  host.saved.topics = host.saved.topics.filter(t => t !== topic);
  // Remove local authority before waiting on a potentially offline relay.
  try { await save(host.key, host.saved); }
  catch { host.saved.topics.push(topic); throw new Error('Could not save the disconnection. Try again.'); }
  notify();
  await host.adapter.disconnect(topic).catch(() => undefined);
}
