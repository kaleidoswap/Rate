import React from 'react';
import { render } from '@testing-library/react-native';
import { RecentActivityWidget } from './RecentActivityWidget';
import type { ActivityItem } from '../services/ActivityService';

const mockItems: ActivityItem[] = [
    {
        id: 'rgb-waiting',
        type: 'receive',
        source: 'transfer',
        asset: 'rgb:asset',
        assetTicker: 'USDT',
        assetPrecision: 0,
        amount: '12',
        status: 'pending',
        txid: '',
        layer: 'RGB-L1',
        rgbTransfer: { status: 'waiting-counterparty', direction: 'incoming' },
    },
    {
        id: 'rgb-settled',
        type: 'receive',
        source: 'transfer',
        asset: 'rgb:asset',
        assetTicker: 'USDT',
        assetPrecision: 0,
        amount: '34',
        status: 'confirmed',
        txid: 'settled',
        layer: 'RGB-L1',
    },
];

jest.mock('../store/hooks', () => ({
    useAppSelector: (select: (state: object) => unknown) => select({
        wallet: { activeWallet: { id: 1 } },
        swap: { swapHistory: [] },
        assets: { rgbAssets: [] },
    }),
}));
jest.mock('../hooks/useFiatRates', () => ({ useFiatRates: () => ({}) }));
jest.mock('../hooks/useActivityFeed', () => ({ useActivityFeed: () => ({ items: mockItems, updating: false, refresh: jest.fn() }) }));
jest.mock('../services/kaleidoPay/activity', () => ({ PAYMENT_ATTEMPT_KIND: 'payment-attempt' }));
jest.mock('./ActivityDetailSheet', () => ({ ActivityDetailSheet: () => null }));

it('fills recent activity with completed items when pending RGB payments are hidden', () => {
    const screen = render(<RecentActivityWidget limit={1} />);
    expect(screen.getByLabelText(/34 USDT.*Completed/)).toBeTruthy();
    expect(screen.queryByLabelText(/12 USDT/)).toBeNull();
});

it('keeps an in-progress RGB payment accessible from that asset’s history', () => {
    const screen = render(<RecentActivityWidget assetId="rgb:asset" />);
    expect(screen.getByLabelText(/12 USDT.*Waiting for sender/)).toBeTruthy();
});
