#!/usr/bin/env node
// Minimal App Store Connect API client (ES256-signed JWT, no deps).
//
//   ASC_KEY_P8=~/.appstoreconnect/private_keys/AuthKey_XXX.p8 \
//   ASC_KEY_ID=XXX ASC_ISSUER_ID=<uuid> \
//   node scripts/asc-api.mjs <METHOD> <path> [jsonBody]
//
// Example:
//   node scripts/asc-api.mjs GET '/v1/apps?filter[bundleId]=com.kaleidoswap.wallet'
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const keyId = process.env.ASC_KEY_ID;
const issuerId = process.env.ASC_ISSUER_ID;
const keyPath = process.env.ASC_KEY_P8;
if (!keyId || !issuerId || !keyPath) {
  console.error('Set ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8');
  process.exit(2);
}
const privateKey = readFileSync(keyPath.replace(/^~/, process.env.HOME), 'utf8');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function makeJwt() {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  // JOSE needs raw R||S, not DER — dsaEncoding 'ieee-p1363'.
  const sig = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

const [, , method = 'GET', path = '/v1/apps', body] = process.argv;
// ASC_BASE lets us target the internal iris backend (https://appstoreconnect.apple.com)
// for operations the public api.appstoreconnect.apple.com host disallows (e.g. app creation).
const base = process.env.ASC_BASE || 'https://api.appstoreconnect.apple.com';
const res = await fetch(`${base}${path}`, {
  method,
  headers: {
    Authorization: `Bearer ${makeJwt()}`,
    'Content-Type': 'application/json',
  },
  body: body || undefined,
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
process.exit(res.ok ? 0 : 1);
