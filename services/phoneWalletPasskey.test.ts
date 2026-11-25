import { createPrivateKey, sign } from 'node:crypto';
import { encodeCBOR, type CBORType } from '@levischuck/tiny-cbor';
import { p256 } from '@noble/curves/nist';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64urlnopad as b64 } from '@scure/base';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';
import { Platform } from 'react-native';
import { Passkey, type PasskeyGetRequest } from 'react-native-passkey';
import {
  approveWithPhoneWalletPasskey,
  enrollPhoneWalletPasskey,
  hasPhoneWalletPasskey,
} from './phoneWalletPasskey';

jest.mock('react-native-passkey', () => ({ Passkey: { create: jest.fn(), get: jest.fn() } }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));

const wallet = 'wallet-fingerprint';
const id = Uint8Array.of(42, 196);
const secret = new Uint8Array(32).fill(1);
const record = new Map<string, string>();
let origin = 'https://kaleidoswap.com',
  flags = 5,
  count = 0,
  wrongSignature = false;
let userHandle = '',
  nonce = 0;
const rp = sha256(utf8ToBytes('kaleidoswap.com'));
function signedAssertion(request: PasskeyGetRequest) {
  const raw = utf8ToBytes(
    JSON.stringify({ type: 'webauthn.get', challenge: request.challenge, origin }),
  );
  const auth = concatBytes(rp, Uint8Array.of(flags, 0, 0, 0, count));
  const key = wrongSignature ? new Uint8Array(32).fill(2) : secret;
  const point = p256.getPublicKey(key, false);
  const privateKey = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: b64.encode(key),
      x: b64.encode(point.slice(1, 33)),
      y: b64.encode(point.slice(33)),
    },
  });
  const signature = sign('sha256', concatBytes(auth, sha256(raw)), privateKey);
  return {
    type: 'public-key',
    id: b64.encode(id),
    response: {
      userHandle,
      clientDataJSON: b64.encode(raw),
      authenticatorData: b64.encode(auth),
      signature: b64.encode(signature),
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  record.clear();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  origin = 'https://kaleidoswap.com';
  flags = 5;
  count = 0;
  wrongSignature = false;
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (k) => record.get(k) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (k, v) => {
    record.set(k, v);
  });
  jest.mocked(getRandomBytesAsync).mockImplementation(async (n) => new Uint8Array(n).fill(++nonce));
  jest.mocked(Passkey.create).mockImplementation(async (req) => {
    userHandle = req.user.id;
    const point = p256.getPublicKey(secret, false);
    const cose = encodeCBOR(
      new Map<number, CBORType>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, point.slice(1, 33)],
        [-3, point.slice(33)],
      ]),
    );
    const extensions = encodeCBOR(new Map([['credProtect', 2]]));
    const auth = concatBytes(
      rp,
      Uint8Array.of(0xc0 | flags, 0, 0, 0, 0),
      new Uint8Array(16),
      Uint8Array.of(0, id.length),
      id,
      cose,
      extensions,
    );
    const att = encodeCBOR(
      new Map<string, CBORType>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', auth],
      ]),
    );
    const json = utf8ToBytes(
      JSON.stringify({ type: 'webauthn.create', challenge: req.challenge, origin }),
    );
    return {
      type: 'public-key',
      id: b64.encode(id),
      rawId: b64.encode(id),
      response: { attestationObject: b64.encode(att), clientDataJSON: b64.encode(json) },
    };
  });
  jest.mocked(Passkey.get).mockImplementation(async (req) => signedAssertion(req));
});

it('pins the explicitly enrolled credential and verifies signed, single-use payment challenges', async () => {
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice')).rejects.toThrow(/Enroll/);
  expect(Passkey.create).not.toHaveBeenCalled();
  await enrollPhoneWalletPasskey(wallet);
  await enrollPhoneWalletPasskey(wallet);
  expect(Passkey.create).toHaveBeenCalledTimes(1);
  expect(await hasPhoneWalletPasskey(wallet)).toBe(true);
  expect(await hasPhoneWalletPasskey('other-wallet')).toBe(false);
  count = 1;
  await approveWithPhoneWalletPasskey(wallet, 'invoice-A');
  const request = jest.mocked(Passkey.get).mock.calls[0][0];
  expect(request).toMatchObject({
    allowCredentials: [{ id: b64.encode(id), type: 'public-key' }],
    userVerification: 'required',
  });
  jest.mocked(Passkey.get).mockResolvedValueOnce(signedAssertion(request));
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice-B')).rejects.toThrow(/verify/);
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice-A')).rejects.toThrow(/verify/);
  count = 2;
  await approveWithPhoneWalletPasskey(wallet, 'invoice-B');
});

it('refuses incorrect origin, signature, UV, credential id and provider cancellation', async () => {
  await enrollPhoneWalletPasskey(wallet);
  origin = 'https://example.invalid';
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice')).rejects.toThrow(/verify/);
  origin = 'https://kaleidoswap.com';
  flags = 1;
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice')).rejects.toThrow(/verify/);
  flags = 5;
  wrongSignature = true;
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice')).rejects.toThrow(/verify/);
  wrongSignature = false;
  jest
    .mocked(Passkey.get)
    .mockImplementationOnce(async (req) => ({ ...signedAssertion(req), id: 'another' }));
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice')).rejects.toThrow(/verify/);
  jest.mocked(Passkey.get).mockRejectedValueOnce(new Error('User cancelled'));
  await expect(approveWithPhoneWalletPasskey(wallet, 'invoice')).rejects.toThrow(/cancelled/);
});

it('pins the Android signing certificate and rejects unsigned builds and unverified enrollment', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const previous = process.env.EXPO_PUBLIC_PASSKEY_ANDROID_CERT_SHA256;
  try {
    delete process.env.EXPO_PUBLIC_PASSKEY_ANDROID_CERT_SHA256;
    await expect(enrollPhoneWalletPasskey(wallet)).rejects.toThrow(/unavailable/);
    process.env.EXPO_PUBLIC_PASSKEY_ANDROID_CERT_SHA256 = '01'.repeat(32);
    await expect(enrollPhoneWalletPasskey(wallet)).rejects.toThrow(/verify/);
    origin = 'android:apk-key-hash:' + b64.encode(new Uint8Array(32).fill(1));
    flags = 1;
    await expect(enrollPhoneWalletPasskey(wallet)).rejects.toThrow(/verify/);
    expect(await hasPhoneWalletPasskey(wallet)).toBe(false);
    flags = 5;
    await enrollPhoneWalletPasskey(wallet);
    await approveWithPhoneWalletPasskey(wallet, 'invoice');
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_PASSKEY_ANDROID_CERT_SHA256;
    else process.env.EXPO_PUBLIC_PASSKEY_ANDROID_CERT_SHA256 = previous;
  }
});
