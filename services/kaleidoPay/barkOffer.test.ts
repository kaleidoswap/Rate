import { BarkReactNativeAdapter } from '@kaleidorg/wallet-engine/adapters/bark-react-native';

// Guards patches/@kaleidorg__wallet-engine@*.patch: Bark pays BOLT12 offers through payLightningOffer.
test('the Bark adapter sends a BOLT12 offer to payLightningOffer', async () => {
  const adapter = new BarkReactNativeAdapter({ runtime: { now: () => 1 } });
  const preimage = '00'.repeat(32);
  const paymentHash = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925'; // SHA256 of 32 zero bytes
  const port = { payLightningOffer: jest.fn().mockResolvedValue({ type: 'paid', payment_hash: paymentHash, preimage }) };
  (adapter.backend as any).getWalletPort = () => port;
  const result = await adapter.sendPayment({ invoice: 'lno1qcp4256ypq', amount: 1200 } as any);
  expect(port.payLightningOffer).toHaveBeenCalledWith({ offer: 'lno1qcp4256ypq', amountSats: 1200, wait: true });
  expect(result).toMatchObject({ paymentHash, status: 'confirmed', preimage });
});
