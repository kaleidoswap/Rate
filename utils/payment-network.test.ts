import { paymentNetworks, paymentRequestLabel } from './payment-network';
test('distinguishes regtest from mainnet and leaves ambiguous test addresses explicit', () => {
  expect(paymentNetworks('lightning:LNBCrt100n1example')).toEqual(['Regtest']);
  expect(paymentNetworks('lnbc100n1example')).toEqual(['Mainnet']);
  expect(paymentNetworks('tb1example')).toEqual(['Testnet / Signet']);
  expect(paymentNetworks('lno1example')).toEqual([]);
});
test('does not label a mixed request as one network', () => {
  const uri = 'BITCOIN:bc1example?LIGHTNING=lnbcrt100n1example';
  expect(paymentNetworks(uri)).toEqual(['Mainnet', 'Regtest']);
  expect(paymentRequestLabel(uri)).toBe('Multi-method payment request');
});
