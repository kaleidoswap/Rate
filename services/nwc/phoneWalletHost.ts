import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
  type Event,
} from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { getStore } from '../../store/storeProvider';
import DatabaseService from '../DatabaseService';
import { isAppUnlocked } from '../appLockState';
import { currentWebRgbAccount } from '../webrgb/account';
import { withRgbApproval } from '../rgbApproval';
import {
  approveWithPhoneWalletPasskey,
  enrollPhoneWalletPasskey,
  hasPhoneWalletPasskey,
} from '../phoneWalletPasskey';
import { phoneBrowserStorageKey } from './connectionStore';
import {
  PHONE_METHODS,
  PHONE_RELAY,
  PhoneWalletError,
  checkExpiry,
  nowSeconds,
  parsePhoneInvitation,
  payPhoneInvoice,
  paymentId,
  type PaymentReview,
} from './phoneWalletProtocol';

type Pair = { client: string; key: string; network: string; owner: string };
type Active = { revoking: boolean; walletId: number; pair: Pair; pool: SimplePool; close: () => void };
const restricted = () =>
  new PhoneWalletError('RESTRICTED', 'Open and unlock the paired wallet on the phone.');
const listeners = new Set<() => void>();
let active: Active | null = null;
let generation = 0;
let walletSelection = 0;
let currentWallet: number | undefined;
let pairing = false;
let passkeySheet = false;
let afterPayment: ((walletId: number) => void) | undefined;
export function setPhonePaymentListener(listener?: (id: number) => void) {
  afterPayment = listener;
}
export function onPhoneBackground() {
  // Android Credential Manager may temporarily background the activity. The
  // wallet lock and revocation still invalidate the request during this sheet.
  if (!passkeySheet) invalidatePhoneApprovals();
}
function phoneReview<T>(review: () => Promise<T>): Promise<T> {
  return withRgbApproval(review, () => {
    throw new PhoneWalletError('RESTRICTED', 'Another wallet request is being reviewed on this phone.');
  });
}
async function nativePasskey(run: () => Promise<void>) {
  if (passkeySheet) throw restricted();
  passkeySheet = true;
  try {
    await run();
    if (AppState.currentState !== 'active') {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          subscription.remove();
          reject(restricted());
        }, 1500);
        const subscription = AppState.addEventListener('change', (state) => {
          if (state === 'active') {
            clearTimeout(timer);
            subscription.remove();
            resolve();
          }
        });
      });
    }
  } finally {
    passkeySheet = false;
  }
}
let authorizing: { owner: Active; id: string } | null = null;
let reviewHandler: ((review: PaymentReview) => Promise<void>) | undefined;

export function onPhonePairChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function changed() {
  for (const listener of listeners) listener();
}
export function phonePairInfo() {
  return (
    active && { client: active.pair.client, network: active.pair.network, walletId: active.walletId }
  );
}
export function setPhoneReviewHandler(handler?: (review: PaymentReview) => Promise<void>) {
  reviewHandler = handler;
}
function stop() {
  generation++;
  active?.close();
  active = null;
  changed();
}
function assertForeground(id: number) {
  const wallet = getStore().getState().wallet;
  if (
    AppState.currentState !== 'active' ||
    !isAppUnlocked() ||
    currentWallet !== id ||
    !wallet?.isUnlocked ||
    wallet.activeWallet?.id !== id
  )
    throw restricted();
}
function deviceAccount(id: number) {
  assertForeground(id);
  try {
    return currentWebRgbAccount().account;
  } catch {
    throw new PhoneWalletError('RESTRICTED', 'Enable RGB on this phone for the active wallet.');
  }
}

function publicEvent(key: Uint8Array, kind: number, tags: string[][], content: string) {
  return finalizeEvent({ kind, tags, content, created_at: nowSeconds() }, key);
}
function send(pool: SimplePool, event: Event) {
  return Promise.all(pool.publish([PHONE_RELAY], event));
}
function open(walletId: number, pair: Pair): Active {
  const pool = new SimplePool({ enableReconnect: true });
  const wallet = getPublicKey(hexToBytes(pair.key));
  const host: Active = {
    revoking: false,
    walletId,
    pair,
    pool,
    close: () => {
      sub.close();
      pool.close([PHONE_RELAY]);
    },
  };
  const sub = pool.subscribeMany(
    [PHONE_RELAY],
    {
      kinds: [23194],
      authors: [pair.client],
      '#p': [wallet],
      since: nowSeconds() - 300,
    },
    {
      onevent(event) {
        void handleEvent(host, event).catch(() => undefined);
      },
    },
  );
  return host;
}

export async function selectPhoneWallet(id?: number) {
  stop();
  currentWallet = id;
  const selection = ++walletSelection;
  if (!id) return;
  const raw = await SecureStore.getItemAsync(phoneBrowserStorageKey(id));
  if (!raw || selection !== walletSelection || active) return;
  const pair: Pair = JSON.parse(raw);
  active = open(id, pair);
  changed();
}

export async function pairPhone(raw: string, id: number) {
  if (pairing || active) throw new Error('Disconnect the current browser before pairing another one.');
  const account = deviceAccount(id);
  const invite = parsePhoneInvitation(raw);
  const revision = ++generation;
  const assertCurrent = () => {
    if (revision !== generation || deviceAccount(id) !== account) throw restricted();
    checkExpiry(invite.expires);
  };
  pairing = true;
  try {
    if (await SecureStore.getItemAsync(phoneBrowserStorageKey(id)))
      throw new Error('Disconnect the saved browser before pairing another one.');
    assertCurrent();
    await phoneReview(async () => {
      if (!(await hasPhoneWalletPasskey(account.ownerKey!)))
        await nativePasskey(() => enrollPhoneWalletPasskey(account.ownerKey!));
      assertCurrent();
      await nativePasskey(() =>
        approveWithPhoneWalletPasskey(
          account.ownerKey!,
          JSON.stringify({
            purpose: 'pair-browser',
            client: invite.client,
            nonce: invite.nonce,
            network: account.network,
            expires: invite.expires,
          }),
        ),
      );
    });
    assertCurrent();
    const key = generateSecretKey();
    const wallet = getPublicKey(key);
    const pair = {
      client: invite.client,
      key: bytesToHex(key),
      network: account.network,
      owner: account.ownerKey!,
    };
    const response = nip44.encrypt(
      JSON.stringify({ version: 1, nonce: invite.nonce, wallet, network: pair.network }),
      nip44.getConversationKey(key, pair.client),
    );
    const host = open(id, pair);
    try {
      await send(
        host.pool,
        publicEvent(key, 13194, [['encryption', 'nip44_v2']], PHONE_METHODS.join(' ')),
      );
      assertCurrent();
      await SecureStore.setItemAsync(phoneBrowserStorageKey(id), JSON.stringify(pair), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      assertCurrent();
      active = host;
      changed();
      await send(
        host.pool,
        publicEvent(
          key,
          4147,
          [
            ['p', pair.client],
            ['expiration', String(invite.expires)],
          ],
          response,
        ),
      );
    } catch (error) {
      if (active === host) {
        active = null;
        changed();
      }
      host.close();
      await SecureStore.deleteItemAsync(phoneBrowserStorageKey(id));
      throw error;
    }
  } finally {
    pairing = false;
  }
}
export async function revokePhonePair(id: number) {
  assertForeground(id);
  const host = active;
  if (host) host.revoking = true;
  walletSelection++;
  generation++;
  // Preserve the revoke control when storage is unavailable. The credential is
  // disconnected only after its durable removal succeeds.
  await SecureStore.deleteItemAsync(phoneBrowserStorageKey(id));
  if (active === host) stop();
}

export function invalidatePhoneApprovals() {
  generation++;
}

async function handleEvent(host: Active, event: Event) {
  const { pair, walletId } = host;
  const key = hexToBytes(pair.key);
  const wallet = getPublicKey(key);
  const now = nowSeconds();
  if (
    active !== host ||
    event.kind !== 23194 ||
    event.pubkey !== pair.client ||
    event.content.length > 24_000 ||
    event.created_at < now - 300 ||
    event.created_at > now + 20 ||
    !verifyEvent(event) ||
    !event.tags.some((t) => t[0] === 'p' && t[1] === wallet) ||
    !event.tags.some((t) => t[0] === 'encryption' && t[1] === 'nip44_v2')
  )
    return;
  const shared = nip44.getConversationKey(key, pair.client);
  const req = JSON.parse(nip44.decrypt(event.content, shared));
  const rev = generation;
  const guard = () => {
    assertForeground(walletId);
    if (active !== host || host.revoking || generation !== rev) throw restricted();
    const account = deviceAccount(walletId);
    if (account.ownerKey !== pair.owner || account.network !== pair.network) throw restricted();
    return account;
  };
  let result;
  let error;
  try {
    const ledger = DatabaseService.getInstance();
    if (req.method === 'kaleido_pay_rgb_invoice') {
      const id = paymentId(req.params?.payment_id);
      // A replay can arrive after expiry, lock, process death or completion.
      // Never answer it with a definitive pre-spend refusal once a send might
      // have been dispatched. Only the status query reconciles that claim.
      const recorded = await ledger.browserPayment(walletId, pair.client, id);
      if (recorded && recorded.state !== 'failed') {
        throw new PhoneWalletError('OTHER', 'This request was already received. Check payment status.');
      }
    }
    const account = guard();
    const expiryTags = event.tags.filter((t) => t[0] === 'expiration');
    if (expiryTags.length > 1) throw new PhoneWalletError('INVALID_PARAMS', 'Invalid request expiry.');
    const expiry = Number(expiryTags[0]?.[1]);
    if (expiryTags.length) checkExpiry(expiry);
    if (req.method === 'get_info')
      result = {
        methods: PHONE_METHODS,
        alias: 'KaleidoSwap phone',
        pubkey: wallet,
        network: pair.network,
      };
    else if (req.method === 'kaleido_rgb_payment_status') {
      const id = paymentId(req.params?.payment_id);
      const existing = await ledger.browserPayment(walletId, pair.client, id);
      let status = existing?.state ?? 'not_found';
      if (status === 'reviewing') status = 'pending';
      else if (status === 'pending' && !(authorizing?.owner === host && authorizing.id === id))
        status = 'unknown';
      result = { status, ...(existing?.txid ? { txid: existing.txid } : {}) };
    } else if (req.method === 'kaleido_pay_rgb_invoice') {
      const id = paymentId(req.params?.payment_id);
      if (authorizing)
        throw new PhoneWalletError('OTHER', 'A phone payment is already in progress. Check its status.');
      const op = { owner: host, id };
      authorizing = op;
      try {
        result = await payPhoneInvoice(
          req.params,
          { id: event.id, expiry },
          {
            account,
            walletId,
            wallet,
            client: pair.client,
            ledger,
            guard: () => {
              if (guard() !== account) throw restricted();
            },
            approve: (review) => phoneReview(async () => {
              if (!reviewHandler) throw restricted();
              await reviewHandler(review);
              guard();
              await nativePasskey(() =>
                approveWithPhoneWalletPasskey(pair.owner, JSON.stringify(review)),
              );
            }),
          },
        );
        // UI refresh is best effort. Submission and its persisted receipt are final.
        if (currentWallet === walletId) {
          try {
            afterPayment?.(walletId);
          } catch {
            /* the next wallet refresh picks it up */
          }
        }
      } finally {
        if (authorizing === op) authorizing = null;
      }
    } else throw new PhoneWalletError('NOT_IMPLEMENTED', 'Unsupported phone wallet method.');
  } catch (err) {
    error =
      err instanceof PhoneWalletError
        ? { code: err.code, message: err.message }
        : { code: 'INTERNAL', message: 'The phone could not complete this request.' };
  }
  if (active !== host) return;
  const content = nip44.encrypt(
    JSON.stringify({ result_type: req.method, ...(error ? { error } : { result }) }),
    shared,
  );
  await send(
    host.pool,
    publicEvent(
      key,
      23195,
      [
        ['p', pair.client],
        ['e', event.id],
        ['encryption', 'nip44_v2'],
      ],
      content,
    ),
  );
}
