import { decodeCBOR, decodePartialCBOR } from '@levischuck/tiny-cbor';
import { p256 } from '@noble/curves/nist';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64urlnopad as b64 } from '@scure/base';
import { Buffer } from 'buffer';
import { getRandomBytesAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { Passkey } from 'react-native-passkey';

const RP = 'kaleidoswap.com';
const rpHash = bytesToHex(sha256(utf8ToBytes(RP)));
interface Credential {
  id: string;
  userHandle: string;
  publicKey: string;
  counter: number;
}

// A seed-derived wallet fingerprint survives database row renumbering and device reinstalls.
const recordKey = (wallet: string) => 'phone-passkey-v1.' + bytesToHex(sha256(utf8ToBytes(wallet)));

function expectedOrigin(): string {
  if (Platform.OS === 'ios') return 'https://' + RP;
  const hex = process.env.EXPO_PUBLIC_PASSKEY_ANDROID_CERT_SHA256?.replace(/:/g, '');
  if (Platform.OS === 'android' && hex && /^[a-f0-9]{64}$/i.test(hex)) {
    return 'android:apk-key-hash:' + b64.encode(hexToBytes(hex));
  }
  throw new Error('Passkeys for browser payments are unavailable in this build.');
}

function requireProof(ok: unknown): asserts ok {
  if (!ok) throw new Error('The wallet could not verify the passkey.');
}

function verifyClientData(encoded: string, type: string, challenge: string, origin: string) {
  const raw = b64.decode(encoded);
  const client = JSON.parse(Buffer.from(raw).toString('utf8'));
  requireProof(client.type === type && client.challenge === challenge && client.origin === origin);
  requireProof(client.crossOrigin === undefined || client.crossOrigin === false);
  return sha256(raw);
}

function verifyAuthData(authData: Uint8Array, registration: boolean): number {
  requireProof(authData.length >= 37 && bytesToHex(authData.subarray(0, 32)) === rpHash);
  const flags = authData[32];
  // Require user presence and verification, and attested credential data only at enrollment.
  requireProof((flags & 5) === 5 && Boolean(flags & 0x40) === registration);
  requireProof(!(flags & 0x10) || Boolean(flags & 0x08));
  return new DataView(authData.buffer, authData.byteOffset, authData.byteLength).getUint32(33);
}

async function readCredential(walletId: string): Promise<Credential | null> {
  const saved = await SecureStore.getItemAsync(recordKey(walletId));
  return saved ? JSON.parse(saved) : null;
}

export async function hasPhoneWalletPasskey(walletId: string): Promise<boolean> {
  return (await readCredential(walletId)) !== null;
}

function saveCredential(wallet: string, credential: Credential) {
  return SecureStore.setItemAsync(recordKey(wallet), JSON.stringify(credential), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

// OS credential sheets and the local signature counter must be used serially.
let active = false;
async function ceremony(action: () => Promise<void>) {
  if (active) throw new Error('Another passkey request is in progress.');
  active = true;
  try {
    await action();
  } finally {
    active = false;
  }
}

/** Explicit user action during pairing. A payment request can never enroll or replace a passkey. */
export function enrollPhoneWalletPasskey(walletId: string): Promise<void> {
  return ceremony(async () => {
    if (await readCredential(walletId)) return;
    const origin = expectedOrigin();
    const challenge = b64.encode(await getRandomBytesAsync(32));
    const userHandle = b64.encode(await getRandomBytesAsync(32));
    const name = 'Wallet ' + userHandle.slice(0, 8);
    const created = await Passkey.create({
      challenge,
      rp: { id: RP, name: 'KaleidoSwap' },
      user: { id: userHandle, name, displayName: name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      attestation: 'none',
      timeout: 60000,
    });
    requireProof(created.type === 'public-key' && created.rawId === created.id);
    verifyClientData(created.response.clientDataJSON, 'webauthn.create', challenge, origin);
    const att = decodeCBOR(b64.decode(created.response.attestationObject));
    requireProof(att instanceof Map && att.get('fmt') === 'none');
    const statement = att.get('attStmt');
    requireProof(statement instanceof Map && statement.size === 0);
    const auth = att.get('authData');
    requireProof(auth instanceof Uint8Array && auth.length >= 55);
    const counter = verifyAuthData(auth, true);
    const idSize = (auth[53] << 8) | auth[54];
    requireProof(idSize > 0 && idSize <= 1023 && auth.length > 55 + idSize);
    requireProof(b64.encode(auth.subarray(55, 55 + idSize)) === created.id);
    const keyOffset = 55 + idSize;
    const [cose, keyLength] = decodePartialCBOR(auth, keyOffset);
    // Some platform authenticators append extension outputs (e.g. credProtect) to the COSE key.
    if (auth[32] & 0x80) {
      requireProof(decodeCBOR(auth.subarray(keyOffset + keyLength)) instanceof Map);
    } else {
      requireProof(auth.length === keyOffset + keyLength);
    }
    requireProof(cose instanceof Map && cose.get(1) === 2 && cose.get(3) === -7 && cose.get(-1) === 1);
    const x = cose.get(-2),
      y = cose.get(-3);
    requireProof(
      x instanceof Uint8Array && x.length === 32 && y instanceof Uint8Array && y.length === 32,
    );
    const publicKey = concatBytes(Uint8Array.of(4), x, y);
    p256.Point.fromHex(publicKey).assertValidity();
    await saveCredential(walletId, {
      id: created.id,
      userHandle,
      publicKey: b64.encode(publicKey),
      counter,
    });
  });
}

/** The caller passes the exact request shown to the user, including the requesting connection and the recipient. */
export function approveWithPhoneWalletPasskey(walletId: string, intent: string): Promise<void> {
  return ceremony(async () => {
    if (!intent) throw new Error('Missing payment details.');
    const enrolled = await readCredential(walletId);
    if (!enrolled) throw new Error('Enroll a wallet passkey before connecting the browser.');
    const origin = expectedOrigin();
    const nonce = b64.encode(await getRandomBytesAsync(32));
    const binding = JSON.stringify(['kaleidoswap/phone-wallet/approval/v1', walletId, nonce, intent]);
    const challenge = b64.encode(sha256(utf8ToBytes(binding)));
    const assertion = await Passkey.get({
      rpId: RP,
      challenge,
      allowCredentials: [{ id: enrolled.id, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    });
    requireProof(assertion.type === 'public-key' && assertion.id === enrolled.id);
    requireProof(assertion.rawId === undefined || assertion.rawId === enrolled.id);
    const response = assertion.response;
    requireProof(!response.userHandle || response.userHandle === enrolled.userHandle);
    const clientHash = verifyClientData(response.clientDataJSON, 'webauthn.get', challenge, origin);
    const auth = b64.decode(response.authenticatorData);
    const counter = verifyAuthData(auth, false);
    const signed = sha256(concatBytes(auth, clientHash));
    requireProof(
      p256.verify(b64.decode(response.signature), signed, b64.decode(enrolled.publicKey), {
        format: 'der',
        lowS: false,
      }),
    );
    // Synced passkeys may always return zero. Authenticators that count must advance.
    if (counter !== 0 || enrolled.counter !== 0) {
      requireProof(counter > enrolled.counter);
      await saveCredential(walletId, { ...enrolled, counter });
    }
  });
}
