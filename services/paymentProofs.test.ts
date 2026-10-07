jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { findPaymentProof, withPaymentProofs } from './paymentProofs';

const PREIMAGE = 'cd'.repeat(32);

describe('withPaymentProofs', () => {
  beforeEach(() => AsyncStorage.clear());

  it('keeps the preimage a payment returns and leaves the result untouched', async () => {
    const adapter = { name: 'spark', sendPayment: jest.fn(async function (this: any) { return { paymentHash: 'req-9', preimage: PREIMAGE, owner: this.name }; }) };
    withPaymentProofs(adapter);
    const result = await adapter.sendPayment();
    expect(result).toEqual({ paymentHash: 'req-9', preimage: PREIMAGE, owner: 'spark' });
    await new Promise((r) => setTimeout(r, 0));
    expect((await findPaymentProof(['req-9']))?.preimage).toBe(PREIMAGE);
  });

  it('picks up a preimage that only arrives with a status check', async () => {
    const adapter = { getPaymentStatus: jest.fn(async () => ({ paymentHash: 'p1', status: 'confirmed', preimage: PREIMAGE })) };
    withPaymentProofs(withPaymentProofs(adapter));
    await adapter.getPaymentStatus();
    await new Promise((r) => setTimeout(r, 0));
    expect((await findPaymentProof(['p1']))?.preimage).toBe(PREIMAGE);
  });

  it('passes errors through and tolerates adapters without these methods', async () => {
    const adapter = { sendPayment: jest.fn(async () => { throw new Error('no route'); }) };
    withPaymentProofs(adapter);
    await expect(adapter.sendPayment()).rejects.toThrow('no route');
    expect(withPaymentProofs({})).toEqual({ __paymentProofs: true });
  });
});
