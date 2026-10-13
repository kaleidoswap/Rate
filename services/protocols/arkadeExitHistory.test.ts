import { arkadeExitHistory } from './arkadeExitHistory';
jest.mock('@arkade-os/sdk', () => ({ hasTerminalSpend: (v: any) => !!v.isSpent }));
test('exits exclude spent ancestors and require on-chain proof for confirmation', async () => {
  const rows = await arkadeExitHistory({ getVtxos: async () => [
    { txid: 'old', vout: 0, value: 1000, isSpent: true, isUnrolled: true },
    { txid: 'exit', vout: 0, value: 1000, isUnrolled: true },
    { txid: 'other', vout: 0, value: 2000, isUnrolled: true },
  ], onchainProvider: { getTxStatus: async (txid: string) => ({ confirmed: txid === 'exit', blockTime: txid === 'exit' ? 100 : undefined }) } } as any);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ amount: 1000, status: 'confirmed', timestamp: 100000, protocolData: { kind: 'unilateral_exit', exitTxid: 'exit' } });
  expect(rows[1]).toMatchObject({ status: 'pending', timestamp: 0 });
});
