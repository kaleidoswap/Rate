import { activityExplorerUrl } from './explorer';

const TXID = 'ab'.repeat(32);
const item = (over: any) => ({ layer: 'L1' as const, txid: TXID, network: 'mainnet', ...over });

describe('activityExplorerUrl', () => {
  it('links on-chain txids to mempool.space for the item network', () => {
    expect(activityExplorerUrl(item({}))).toBe(`https://mempool.space/tx/${TXID}`);
    expect(activityExplorerUrl(item({ network: 'bitcoin' }))).toBe(`https://mempool.space/tx/${TXID}`);
    expect(activityExplorerUrl(item({ network: 'signet' }))).toBe(`https://mempool.space/signet/tx/${TXID}`);
    expect(activityExplorerUrl(item({ network: 'testnet4' }))).toBe(`https://mempool.space/testnet4/tx/${TXID}`);
    expect(activityExplorerUrl(item({ network: 'Mutinynet' }))).toBe(`https://mutinynet.com/tx/${TXID}`);
  });

  it('reads the RGB account networks as the node names them', () => {
    expect(activityExplorerUrl(item({ account: 'RGB', network: 'signet' }))).toBe(`https://mutinynet.com/tx/${TXID}`);
    expect(activityExplorerUrl(item({ layer: 'RGB-L1', network: 'testnet' }))).toBe(`https://mempool.space/testnet/tx/${TXID}`);
    expect(activityExplorerUrl(item({ layer: 'RGB-L1', network: 'mainnet' }))).toBe(`https://mempool.space/tx/${TXID}`);
  });

  it('has no link off-chain, on regtest, without a network or a txid', () => {
    expect(activityExplorerUrl(item({ layer: 'LN' }))).toBeNull();
    expect(activityExplorerUrl(item({ layer: 'Spark' }))).toBeNull();
    expect(activityExplorerUrl(item({ network: 'regtest' }))).toBeNull();
    expect(activityExplorerUrl(item({ network: undefined }))).toBeNull();
    expect(activityExplorerUrl(item({ txid: 'not-a-txid' }))).toBeNull();
    expect(activityExplorerUrl(item({ txid: '' }))).toBeNull();
  });
});
