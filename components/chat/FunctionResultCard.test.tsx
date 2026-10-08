import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import FunctionResultCard, { balanceDataFor } from './FunctionResultCard';
import { sharePayable } from '../InvoiceQRCode';

jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('../../services/btcmapService', () => ({ formatDistance: (m: number) => `${m} m` }));
jest.mock('../InvoiceQRCode', () => ({ __esModule: true, default: () => null, sharePayable: jest.fn(async () => true), shareLightningInvoice: jest.fn() }));

const renderCard = (name: string, result: any, onCopy = jest.fn()) =>
  render(<FunctionResultCard functionCalled={name} functionResult={result} onCopy={onCopy} onOpenLink={jest.fn()} />);

describe('FunctionResultCard — current tool names', () => {
  it('maps every balance tool to the balance card', () => {
    expect(balanceDataFor('get_balances', { total_sats: 3, layers: [{ layer: 'spark', btc_sats: 3 }] })).toEqual({ total_sats: 3, layers: [{ layer: 'spark', btc_sats: 3 }] });
    expect(balanceDataFor('spark_get_balance', { total: 1500 })).toEqual({ total_sats: 1500, layers: [{ layer: 'spark', btc_sats: 1500, assets: [] }] });
    expect(balanceDataFor('rln_get_balances', { btc: { total: 9 }, assets: [{ ticker: 'USDT', balance: 5 }, { ticker: 'BTC' }] }))
      .toEqual({ total_sats: 9, layers: [{ layer: 'rln', btc_sats: 9, assets: [{ ticker: 'USDT', balance: 5 }] }] });
    expect(balanceDataFor('send_payment', { total: 1 })).toBeNull();
    expect(renderCard('get_balances', { total_sats: 21_000, layers: [{ layer: 'spark', btc_sats: 21_000 }] }).getAllByText('21,000 sats').length).toBeGreaterThan(0);
  });

  it('shows a receive address with copy and a working share', () => {
    const onCopy = jest.fn();
    const view = renderCard('spark_get_address', { address: 'sp1qexampleaddress' }, onCopy);
    expect(view.getByText('Spark address')).toBeTruthy();
    expect(view.getByText('sp1qexampleaddress')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Copy Spark address'));
    expect(onCopy).toHaveBeenCalledWith('sp1qexampleaddress', 'Spark address');
    fireEvent.press(view.getByLabelText('Share Spark address'));
    expect(sharePayable).toHaveBeenCalledWith('sp1qexampleaddress', 'Spark address');
  });

  it('shows an RGB invoice as a payable, not as sats', () => {
    const view = renderCard('rln_create_rgb_invoice', { invoice: 'rgb:~/~/bcrt:utxob:abc' });
    expect(view.getByText('RGB invoice')).toBeTruthy();
    expect(view.queryByText(/sats/)).toBeNull();
  });

  it('shows a swap quote and its venue', () => {
    const view = renderCard('kaleidoswap_get_quote', {
      quote_id: 'q1', venue: 'flashnet', from_asset: 'BTC', to_asset: 'USDB', send_amount: 25_000,
      receive_amount: 20.1, receive_unit: 'USDB', fee: 50, fee_unit: 'sats',
    });
    expect(view.getByText('Swap quote · Flashnet')).toBeTruthy();
    expect(view.getByText('25,000 sats')).toBeTruthy();
    expect(view.getByText('20.1 USDB')).toBeTruthy();
    expect(view.getByText('50 sats')).toBeTruthy();
  });

  it('shows swap and payment results', () => {
    expect(renderCard('execute_swap', { atomic_id: 'h', venue: 'kaleidoswap', status: 'executing', payment_hash: 'abcdef0123456789abcdef0123456789' }).getByText('Swap started · KaleidoSwap')).toBeTruthy();
    const onCopy = jest.fn();
    const sent = renderCard('send_payment', { status: 'confirmed', amount: 2100, fee: 3, preimage: 'pre' }, onCopy);
    expect(sent.getByText('Payment sent · 2,100 sats')).toBeTruthy();
    expect(sent.getByText('Fee 3 sats')).toBeTruthy();
    fireEvent.press(sent.getByLabelText('Copy preimage'));
    expect(onCopy).toHaveBeenCalledWith('pre', 'Preimage');
    expect(renderCard('rln_pay_invoice', { status: 'failed', paymentHash: 'h' }).getByText('Payment failed')).toBeTruthy();
    expect(renderCard('send_payment', { error: 'no route' }).getByText('Payment failed: no route')).toBeTruthy();
  });
});
