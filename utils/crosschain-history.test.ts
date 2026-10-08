import {
  activityStatusOf,
  formatRecordAmount,
  isRecordFinal,
  parseHistory,
  recordFromBridge,
  recordFromSend,
  upsertRecord,
  CROSSCHAIN_HISTORY_LIMIT,
  type CrossChainRecord,
} from './crosschain-history';

const quote: any = { quoteId: 'q1', depositAddress: '0xabc', amountIn: '2000000', estimatedOut: '3000', expiresAt: '' };

describe('cross-chain history', () => {
  it('records a bridge deposit only once a deposit was detected', () => {
    const base: any = { step: 'deposit', sourceChain: 'ethereum', sourceAsset: 'USDT', destAsset: 'BTC', amount: '2', quote, order: null, sourceDecimals: 6, destDecimals: 8 };
    expect(recordFromBridge(base, 1)).toBeNull();
    const rec = recordFromBridge({ ...base, order: { id: 'o1', quoteId: 'q1', status: 'bridging', readToken: 't' } }, 5)!;
    expect(rec).toMatchObject({ id: 'q1', direction: 'deposit', destChain: 'spark', orderId: 'o1', readToken: 't', status: 'bridging', amountOutRaw: '3000' });
  });

  it('records a send from the moment it may pay, as unpaid until confirmed', () => {
    const session: any = {
      quoteId: 'q2', phase: 'paying', source: 'USDB', destChain: 'base', destToken: 'USDC', destDecimals: 6,
      sourceAmountRaw: '5000000', expectedOutRaw: '4990000', recipient: '0xdef', createdAt: 1, updatedAt: 2,
    };
    expect(recordFromSend(session)).toMatchObject({ direction: 'send', status: 'unpaid', sourceChain: 'spark', recipient: '0xdef' });
    expect(recordFromSend({ ...session, phase: 'paid' }).status).toBe('processing');
    expect(recordFromSend({ ...session, dismissedAt: 3 }).status).toBe('failed');
    expect(recordFromSend({ ...session, phase: 'paid', dismissedAt: 3 }).status).toBe('processing');
    expect(recordFromSend({ ...session, phase: 'submitted', order: { id: 'o2', status: 'completed', amountOut: '4991000' } }))
      .toMatchObject({ status: 'completed', orderId: 'o2', amountOutRaw: '4991000' });
  });

  it('updates in place, keeps the first date and the known fields', () => {
    const first = { id: 'q', direction: 'send', createdAt: 10, updatedAt: 10, status: 'unpaid', recipient: '0x1' } as CrossChainRecord;
    const list = upsertRecord([first], { ...first, status: 'completed', recipient: undefined, createdAt: 99, updatedAt: 20 } as any);
    expect(list).toEqual([expect.objectContaining({ status: 'completed', recipient: '0x1', createdAt: 10, updatedAt: 20 })]);
  });

  it('keeps the newest records up to the limit', () => {
    let list: CrossChainRecord[] = [];
    for (let i = 0; i < CROSSCHAIN_HISTORY_LIMIT + 5; i++) {
      list = upsertRecord(list, { id: `q${i}`, direction: 'deposit', createdAt: i, updatedAt: i, status: 'completed' } as CrossChainRecord);
    }
    expect(list).toHaveLength(CROSSCHAIN_HISTORY_LIMIT);
    expect(list[0].id).toBe(`q${CROSSCHAIN_HISTORY_LIMIT + 4}`);
  });

  it('maps statuses and amounts for Activity', () => {
    expect(activityStatusOf({ status: 'completed' } as CrossChainRecord)).toBe('confirmed');
    expect(activityStatusOf({ status: 'refunded' } as CrossChainRecord)).toBe('failed');
    expect(activityStatusOf({ status: 'unpaid' } as CrossChainRecord)).toBe('pending');
    expect(isRecordFinal({ status: 'unpaid' } as CrossChainRecord)).toBe(false);
    expect(isRecordFinal({ status: 'failed' } as CrossChainRecord)).toBe(true);
    expect(formatRecordAmount('1500000', 6, 'USDT')).toBe('1.5 USDT');
    expect(formatRecordAmount('12345', 8, 'BTC')).toBe('12,345 sats');
    expect(parseHistory('{bad')).toEqual([]);
  });
});
