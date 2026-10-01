import { lspOrderToPaymentData } from './lspOrder';

describe('lspOrderToPaymentData', () => {
  it('maps the bolt11 payment leg into paymentData (amount in sats)', () => {
    const data = lspOrderToPaymentData({
      order_id: 'ord_1',
      payment: { bolt11: { invoice: 'lnbc1xyz', order_total_sat: 125_000 } },
    });
    expect(data).toEqual({
      type: 'lightning',
      invoice: 'lnbc1xyz',
      amount: '125000',
      label: 'Channel order ord_1',
      selectedAsset: { asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false },
    });
  });

  it('returns null when the order has no invoice to pay', () => {
    expect(lspOrderToPaymentData(undefined)).toBeNull();
    expect(lspOrderToPaymentData({ order_id: 'x', payment: { bolt11: null } })).toBeNull();
  });

  it('leaves the amount unset when the total is missing', () => {
    const data = lspOrderToPaymentData({ payment: { bolt11: { invoice: 'lnbc1xyz' } } });
    expect(data?.amount).toBeUndefined();
    expect(data?.label).toBe('Channel order');
  });
});
