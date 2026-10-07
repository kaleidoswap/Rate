import { qrPayload } from './qrPayload';

test('upper-cases the case-insensitive parts of a unified request', () => {
  expect(qrPayload('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.0001&label=Coffee%20Bar&lightning=lnbc1u1pj9xyzabc'))
    .toBe('BITCOIN:BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH?amount=0.0001&label=Coffee%20Bar&lightning=LNBC1U1PJ9XYZABC');
  expect(qrPayload('lnbc10u1pj9xyz')).toBe('LNBC10U1PJ9XYZ');
  expect(qrPayload('lightning:lno1qgsqvgnwgcg')).toBe('LIGHTNING:LNO1QGSQVGNWGCG');
});

test('leaves case-sensitive codes alone', () => {
  expect(qrPayload('bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=1')).toBe('BITCOIN:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=1');
  expect(qrPayload('rgb:2dkSTbr-jFhznbPmo-TQafzswCN-av4gTsJjX-ttx6CNou5-M98k8Zd/~/bcrt:utxob:abc')).toBe('rgb:2dkSTbr-jFhznbPmo-TQafzswCN-av4gTsJjX-ttx6CNou5-M98k8Zd/~/bcrt:utxob:abc');
  expect(qrPayload('alice@kaleidoswap.me')).toBe('alice@kaleidoswap.me');
  expect(qrPayload('spark1pgssabc')).toBe('spark1pgssabc');
});
