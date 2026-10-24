import { createRgbLibRnModule } from './rgbLibRn';

// A stand-in for modules/kaleido-rgb with just what opening a wallet and the swap calls need.
function fakeLib(supportsAtomicSwaps?: boolean) {
  const order: string[] = [];
  const wallet = {
    goOnline: jest.fn(async () => undefined),
    listUnspents: jest.fn(async () => {
      order.push('listUnspents');
      return [{ utxo: { outpoint: { txid: 'ab'.repeat(32), vout: 1 }, btcAmount: 1000, colorable: true, exists: true, derivationIndex: 0 }, rgbAllocations: [], pendingBlinded: 0 }];
    }),
    acceptSwapOffer: jest.fn(async () => { order.push('acceptSwapOffer'); return '{"request":1}'; }),
    completeSwapProposal: jest.fn(async () => { order.push('completeSwapProposal'); return '{"completion":1}'; }),
    acceptSwapTransfers: jest.fn(async () => { order.push('acceptSwapTransfers'); }),
    close: jest.fn(async () => undefined),
  };
  const lib: Record<string, unknown> = {
    restoreKeys: jest.fn(async (network: string, mnemonic: string) => ({ mnemonic, network, xpub: 'x', accountXpubVanilla: 'v', accountXpubColored: 'c', masterFingerprint: 'f' })),
    Wallet: jest.fn(() => wallet),
    supportsSubdir: jest.fn(() => true),
  };
  if (supportsAtomicSwaps !== undefined) lib.supportsAtomicSwaps = jest.fn(() => supportsAtomicSwaps);
  return { lib, wallet, order };
}

const open = (lib: unknown) =>
  new (createRgbLibRnModule(() => lib as any).WalletManagerRgb)('seed', { network: 'mutinynet', indexerUrl: 'https://i', transportEndpoint: 'rpcs://p' }).getAccount();

test('no swap wallet on a build without rgb-lib swap calls', async () => {
  expect((await open(fakeLib().lib)).atomicSwapWallet()).toBeNull();
  expect((await open(fakeLib(false).lib)).atomicSwapWallet()).toBeNull();
});

test('the swap wallet runs rgb-lib swap calls as the taker, with every coin the wallet holds', async () => {
  const { lib, wallet, order } = fakeLib(true);
  const swap = (await open(lib)).atomicSwapWallet()!;
  expect(await swap.walletOutpoints()).toEqual([{ txid: 'ab'.repeat(32), vout: 1 }]);
  expect(wallet.listUnspents).toHaveBeenCalledWith(false, false);
  expect(await swap.acceptSwapOffer('{"offer":1}')).toBe('{"request":1}');
  expect(wallet.acceptSwapOffer).toHaveBeenCalledWith('{"offer":1}', 1);
  expect(await swap.completeSwapProposal('{"proposal":1}')).toBe('{"completion":1}');
  expect(wallet.completeSwapProposal).toHaveBeenCalledWith('{"proposal":1}', 1);
  await swap.acceptSwapTransfers('{"final":1}');
  expect(wallet.acceptSwapTransfers).toHaveBeenCalledWith('{"final":1}', 'TAKER');
  expect(order).toEqual(['listUnspents', 'acceptSwapOffer', 'completeSwapProposal', 'acceptSwapTransfers']);
});
