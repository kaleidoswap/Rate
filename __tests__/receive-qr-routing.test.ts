import {
  buildUnifiedReceiveURI,
  parseUnifiedReceiveURI,
} from '../node_modules/@kaleidorg/wallet-engine/dist/receive/unifiedReceive.js';

import { classifyWithdrawDestination } from '../utils/account-routing';

describe('receive QR routing', () => {
  const sparkAddress = `spark1${'q'.repeat(32)}`;
  const bitcoinAddress = `bc1q${'p'.repeat(38)}`;

  it('keeps a native Spark address distinct from a Bitcoin address', () => {
    expect(classifyWithdrawDestination(sparkAddress)).toBe('spark');
    expect(classifyWithdrawDestination(bitcoinAddress)).toBe('bitcoin');
  });

  it('round-trips the Spark rail in a unified QR without placing it in the BIP21 path', () => {
    const uri = buildUnifiedReceiveURI({ sparkAddress, btcAddress: bitcoinAddress });
    const parsed = parseUnifiedReceiveURI(uri);

    expect(uri).toContain(`spark=${sparkAddress}`);
    expect(parsed?.sparkAddress).toBe(sparkAddress);
    expect(parsed?.btcAddress).toBe(bitcoinAddress);
  });

  it('builds a Spark-only QR with an empty Bitcoin path', () => {
    const uri = buildUnifiedReceiveURI({ sparkAddress });

    expect(uri).toMatch(/^bitcoin:\?spark=/);
    expect(parseUnifiedReceiveURI(uri)?.btcAddress).toBeUndefined();
    expect(parseUnifiedReceiveURI(uri)?.sparkAddress).toBe(sparkAddress);
  });
});
