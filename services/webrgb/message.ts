import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base32nopad } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

const RESERVED_LNURL_MESSAGE = 'DO NOT EVER SIGN THIS TEXT WITH YOUR PRIVATE KEYS! IT IS ONLY USED FOR DERIVATION OF LNURL-AUTH HASHING-KEY, DISCLOSING ITS SIGNATURE WILL COMPROMISE YOUR LNURL-AUTH IDENTITY AND MAY LEAD TO LOSS OF FUNDS!';

export function validateSignMessage(message: string): void {
  if (typeof message !== 'string' || !message || message.length > 8192 ||
      /[\uD800-\uDFFF]/u.test(message) || message.trim() === RESERVED_LNURL_MESSAGE) {
    throw Object.assign(new Error('This message cannot be signed.'), { code: 'INVALID_PARAMS' });
  }
}

/** LND signmessage, using the dedicated m/138'/1 message key shared with our browser wallet. */
export function signWebRgbMessage(message: string, mnemonic: string): string {
  validateSignMessage(message);
  const seed = mnemonicToSeedSync(mnemonic.trim());
  const master = HDKey.fromMasterSeed(seed);
  seed.fill(0);
  const child = master.derive("m/138'/1");
  master.wipePrivateData();
  try {
    if (!child.privateKey) throw new Error('Wallet message key unavailable.');
    const digest = sha256(sha256(utf8ToBytes('Lightning Signed Message:' + message)));
    const signature = secp256k1.sign(digest, child.privateKey, { lowS: true, prehash: false });
    const bytes = signature.toBytes('recovered');
    bytes[0] += 31;
    const zbase = 'ybndrfg8ejkmcpqxot1uwisza345h769';
    const rfc4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    return Array.from(base32nopad.encode(bytes), c => zbase[rfc4648.indexOf(c)]).join('');
  } finally {
    child.wipePrivateData();
  }
}
