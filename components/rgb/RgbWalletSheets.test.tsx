import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RgbUtxoSheet } from './RgbUtxoSheet';
import { IssueAssetSheet } from './IssueAssetSheet';
import { InflateAssetSheet } from './InflateAssetSheet';

jest.mock('../../services/protocols', () => ({ rgbAccountAdapter: () => null }));
const mockPick = jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///photos/art.png' }] }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: () => mockPick() }));

const unspents = [
  { utxo: { outpoint: { txid: 'a'.repeat(64), vout: 0 }, btcAmount: 1000, colorable: true },
    rgbAllocations: [{ assetId: 'rgb:usdt', assignment: { type: 'FUNGIBLE', amount: 2_500_000 }, settled: true }], pendingBlinded: 0 },
  { utxo: { outpoint: { txid: 'b'.repeat(64), vout: 1 }, btcAmount: 1000, colorable: true }, rgbAllocations: [], pendingBlinded: 0 },
  { utxo: { outpoint: { txid: 'c'.repeat(64), vout: 2 }, btcAmount: 60_000, colorable: false }, rgbAllocations: [], pendingBlinded: 0 },
];

function device(list: unknown[] = unspents) {
  return {
    protocolName: 'RGB_L1', isConnected: () => true,
    listUnspents: jest.fn(async () => list),
    createRgbUtxos: jest.fn(async () => ({ success: true })),
    issueAssetNia: jest.fn(async () => ({ id: 'rgb:pts', name: 'Points', ticker: 'PTS' })),
    listTransfers: jest.fn(),
    getConnectionInfo: jest.fn(async () => ({ network: 'regtest' })),
    account: { issueAssetCfa: jest.fn(async () => ({ assetId: 'rgb:art', name: 'Art' })), failTransfer: jest.fn(), refreshTransfers: jest.fn() },
  };
}

/** Presses the confirming button of the last Alert. */
async function confirmAlert(text: string) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
  await act(async () => { await buttons.find((b: any) => b.text === text).onPress(); });
}

beforeEach(() => (Alert.alert as jest.Mock).mockClear());

describe('RgbUtxoSheet', () => {
  it('splits UTXOs into holding assets, free and plain bitcoin, with allocations in asset precision', async () => {
    const screen = render(<RgbUtxoSheet visible onClose={jest.fn()} adapter={device()} assets={[{ asset_id: 'rgb:usdt', ticker: 'USDT', precision: 6 }]} />);
    expect(await screen.findByText('2.5 USDT')).toBeTruthy();
    expect(screen.getAllByText('Holding assets').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60,000 sats').length).toBe(2); // the plain-bitcoin total and its one UTXO
    expect(screen.getByText(/^b{8}/)).toBeTruthy();
  });

  it('creates UTXOs after confirming, then reloads', async () => {
    const adapter = device();
    const onCreated = jest.fn();
    const screen = render(<RgbUtxoSheet visible onClose={jest.fn()} adapter={adapter} onCreated={onCreated} />);
    await screen.findAllByText('60,000 sats');
    fireEvent.press(screen.getByText('5'));
    fireEvent.press(screen.getByText('Create 5 UTXOs'));
    await confirmAlert('Create');
    expect(adapter.createRgbUtxos).toHaveBeenCalledWith({ num: 5, size: 3000, feeRate: 2, upTo: false });
    expect(onCreated).toHaveBeenCalled();
    expect(screen.getByText(/Created\. They can be used once the transaction confirms/)).toBeTruthy();
    await waitFor(() => expect(adapter.listUnspents).toHaveBeenCalledTimes(2));
  });

  it('warns when the plain bitcoin can’t cover it, and never shows a raw error', async () => {
    const plain = { utxo: { outpoint: { txid: 'd'.repeat(64), vout: 0 }, btcAmount: 5000, colorable: false }, rgbAllocations: [], pendingBlinded: 0 };
    const adapter = device([unspents[1], plain]);
    adapter.createRgbUtxos.mockRejectedValueOnce(new Error('rgb-lib: InsufficientBitcoins { needed: 9000, available: 0 }'));
    const screen = render(<RgbUtxoSheet visible onClose={jest.fn()} adapter={adapter} />);
    expect(await screen.findByText(/This needs about .* you have 5,000 sats/)).toBeTruthy();
    fireEvent.press(screen.getAllByText('1').at(-1)!);
    fireEvent.press(screen.getAllByText('1,000 sats').at(-1)!);
    expect(screen.queryByText(/This needs about/)).toBeNull();
    fireEvent.press(screen.getByText('Create 1 UTXO'));
    await confirmAlert('Create');
    expect(screen.getByText(/Not enough bitcoin in your RGB wallet/)).toBeTruthy();
    expect(screen.queryByText(/InsufficientBitcoins/)).toBeNull();
  });

  it('a node that does not share UTXOs says so', () => {
    const nwc = { protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: () => false };
    const screen = render(<RgbUtxoSheet visible onClose={jest.fn()} adapter={nwc} />);
    expect(screen.getByText(/doesn’t share its UTXOs/)).toBeTruthy();
    expect(screen.queryByText(/Create \d UTXO/)).toBeNull();
  });
});

describe('IssueAssetSheet', () => {
  it('issues a NIA token after validation and confirmation', async () => {
    const adapter = device();
    const onIssued = jest.fn();
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={adapter} onIssued={onIssued} />);
    fireEvent.press(screen.getByText('Issue asset'));
    expect(screen.getByText('Enter a ticker.')).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Ticker'), 'pts');
    fireEvent.changeText(screen.getByLabelText('Name'), 'Points');
    fireEvent.changeText(screen.getByLabelText('Decimals'), '2');
    fireEvent.changeText(screen.getByLabelText('Supply'), '1000.5');
    fireEvent.press(screen.getByText('Issue 1,000.5 PTS'));
    await confirmAlert('Issue');
    expect(adapter.issueAssetNia).toHaveBeenCalledWith({ ticker: 'PTS', name: 'Points', precision: 2, amounts: [100050] });
    expect(onIssued).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'rgb:pts', supply: 100050 }));
    expect(screen.getByText('Asset issued')).toBeTruthy();
  });

  it('offers CFA where supported, without a ticker', async () => {
    const adapter = device();
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={adapter} />);
    fireEvent.press(screen.getByText('Collectible (CFA)'));
    expect(screen.queryByLabelText('Ticker')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Name'), 'Art');
    fireEvent.changeText(screen.getByLabelText('Description'), 'Edition of ten');
    fireEvent.changeText(screen.getByLabelText('Supply'), '10');
    fireEvent.press(screen.getByText('Issue 10 Art'));
    await confirmAlert('Issue');
    expect(adapter.account.issueAssetCfa).toHaveBeenCalledWith({ name: 'Art', details: 'Edition of ten', precision: 0, amounts: [10] });
  });

  it('a CFA can carry an image picked from the phone', async () => {
    const adapter = device();
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={adapter} />);
    fireEvent.press(screen.getByText('Collectible (CFA)'));
    await act(async () => { fireEvent.press(screen.getByText('Add an image (optional)')); });
    expect(screen.getByLabelText('Chosen image')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Name'), 'Art');
    fireEvent.changeText(screen.getByLabelText('Supply'), '10');
    fireEvent.press(screen.getByText('Issue 10 Art'));
    await confirmAlert('Issue');
    expect(adapter.account.issueAssetCfa).toHaveBeenCalledWith({ name: 'Art', details: null, precision: 0, amounts: [10], filePath: '/photos/art.png' });
  });

  it('issues a UDA (one unit) and an IFA (with what can be issued later) where the native build can', async () => {
    const adapter = device();
    Object.assign(adapter.account, {
      capabilities: () => ({ issueUda: true, issueIfa: true }),
      issueAssetUda: jest.fn(async () => ({ assetId: 'rgb:nft', ticker: 'ART1', name: 'First' })),
      issueAssetIfa: jest.fn(async () => ({ assetId: 'rgb:inf', ticker: 'INF', name: 'Inflatable' })),
    });
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={adapter} />);
    fireEvent.press(screen.getByText('Unique (UDA)'));
    expect(screen.queryByLabelText('Supply')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Ticker'), 'art1');
    fireEvent.changeText(screen.getByLabelText('Name'), 'First');
    fireEvent.press(screen.getByText('Issue 1 ART1'));
    await confirmAlert('Issue');
    expect((adapter.account as any).issueAssetUda).toHaveBeenCalledWith({ ticker: 'ART1', name: 'First', details: null, precision: 0, mediaFilePath: null });
    screen.rerender(<IssueAssetSheet visible={false} onClose={jest.fn()} adapter={adapter} />);
    screen.rerender(<IssueAssetSheet visible onClose={jest.fn()} adapter={adapter} />);
    fireEvent.press(screen.getByText('Inflatable (IFA)'));
    fireEvent.changeText(screen.getByLabelText('Ticker'), 'INF');
    fireEvent.changeText(screen.getByLabelText('Name'), 'Inflatable');
    fireEvent.changeText(screen.getByLabelText('Supply'), '100');
    fireEvent.press(screen.getByText('Issue asset'));
    expect(screen.getByText('Enter how much more may be issued later.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Can issue later'), '50');
    expect(screen.getByText('You’ll hold 100 INF, and can issue up to 50 INF more later.')).toBeTruthy();
    fireEvent.press(screen.getByText('Issue 100 INF'));
    await confirmAlert('Issue');
    expect((adapter.account as any).issueAssetIfa).toHaveBeenCalledWith({ ticker: 'INF', name: 'Inflatable', precision: 0, amounts: [100], inflationAmounts: [50] });
  });

  it('without a free colorable UTXO, offers to create some and blocks issuing', async () => {
    const onCreateUtxos = jest.fn();
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={device([unspents[0], unspents[2]])} onCreateUtxos={onCreateUtxos} />);
    expect(await screen.findByText('Needs a free colorable UTXO')).toBeTruthy();
    fireEvent.press(screen.getByText('Create UTXOs'));
    expect(onCreateUtxos).toHaveBeenCalled();
  });

  it('shows plain wording when issuing fails', async () => {
    const adapter = device();
    adapter.issueAssetNia.mockRejectedValueOnce(new Error('NIA issuance failed: InsufficientAllocationSlots'));
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={adapter} />);
    fireEvent.changeText(screen.getByLabelText('Ticker'), 'PTS');
    fireEvent.changeText(screen.getByLabelText('Name'), 'Points');
    fireEvent.changeText(screen.getByLabelText('Supply'), '5');
    fireEvent.press(screen.getByText('Issue 5 PTS'));
    await confirmAlert('Issue');
    expect(screen.getByText(/You need a free colorable UTXO first/)).toBeTruthy();
    expect(screen.queryByText(/InsufficientAllocationSlots/)).toBeNull();
  });

  it('the node over NWC can’t issue and says so', () => {
    const nwc = { protocolName: 'RGB_LN', isConnected: () => true, walletType: () => 'rln', hasRlnMethod: () => true };
    const screen = render(<IssueAssetSheet visible onClose={jest.fn()} adapter={nwc} />);
    expect(screen.getByText(/can’t issue assets over this connection/)).toBeTruthy();
  });
});

describe('InflateAssetSheet', () => {
  it('issues more within the rights, after confirming', async () => {
    const adapter = device();
    const inflate = jest.fn(async () => ({ txid: 'inf-tx' }));
    Object.assign(adapter.account, { capabilities: () => ({ inflate: true }), inflate });
    const onInflated = jest.fn();
    const screen = render(<InflateAssetSheet visible onClose={jest.fn()} adapter={adapter} asset={{ asset_id: 'rgb:inf', ticker: 'INF', precision: 2 }} rights={5000} onInflated={onInflated} />);
    expect(screen.getByText('You can issue up to 50 INF more')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Amount to issue'), '60');
    expect(screen.getByText('That’s more than your inflation rights allow.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Amount to issue'), '12.5');
    fireEvent.press(screen.getByText('Issue 12.5 INF'));
    await confirmAlert('Issue');
    expect(inflate).toHaveBeenCalledWith({ assetId: 'rgb:inf', inflationAmounts: [1250], feeRate: 2 });
    expect(onInflated).toHaveBeenCalled();
    expect(screen.getByText(/It counts once the transaction confirms/)).toBeTruthy();
  });
});
