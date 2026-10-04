import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ReceiveRequestDetails, groupAddress, middleEllipsis, requestKind } from './ReceiveRequestDetails';
import type { ReceiveMethod } from '../../utils/receive-session';

jest.mock('./ReceiveQr', () => {
  const { Text } = require('react-native');
  return { ReceiveQr: ({ value }: { value: string }) => <Text>{`qr:${value}`}</Text> };
});
jest.mock('./ReceiveRequestActions', () => ({ ReceiveRequestActions: () => null }));
jest.mock('../payments/InvoiceExpiry', () => ({ InvoiceExpiry: () => null }));

const invoice = `lntb1${'x'.repeat(200)}`;
const methods: ReceiveMethod[] = [
  { key: 'onchain', label: 'Bitcoin on-chain', value: 'tb1qexampleaddress0000', protocol: 'SPARK', kind: 'address', layer: 'spark', monitor: 'spark-claim' },
  { key: 'lightning', label: 'Lightning invoice', value: invoice, protocol: 'BARK', kind: 'invoice', layer: 'lightning', monitor: 'invoice' },
  { key: 'ark', label: 'Arkade', value: `tark1${'q'.repeat(60)}`, protocol: 'ARKADE', kind: 'address', layer: 'arkade', monitor: 'balance' },
];

test('names each code and where it lands', () => {
  expect(requestKind(methods[0])).toBe('Bitcoin address');
  expect(requestKind(methods[1])).toBe('Lightning invoice');
  expect(requestKind(methods[2])).toBe('Ark address');
  expect(groupAddress('tb1qabcdefgh')).toBe('tb1q abcd efgh');
  expect(middleEllipsis(invoice)).toMatch(/^lntb1x{9}….{10}$/);
});

test('the universal code lists every way to pay it, each on its own QR', () => {
  const screen = render(<ReceiveRequestDetails methods={methods} universal qrSize={200}
    notes={["Bark isn't included: it's on Signet."]} />);
  expect(screen.getByText('Any of these can pay this code')).toBeTruthy();
  expect(screen.getByText('Lightning invoice')).toBeTruthy();
  expect(screen.getByText(/^Bark · lntb1/)).toBeTruthy();
  expect(screen.getByText("Bark isn't included: it's on Signet.")).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Show the Ark address on its own'));
  expect(screen.getByText(`qr:${methods[2].value}`)).toBeTruthy();
  expect(screen.getByText('Lands in Arkade')).toBeTruthy();
});

test('a single long invoice is shortened until asked for in full', () => {
  const screen = render(<ReceiveRequestDetails methods={[methods[1]]} universal={false} qrSize={200} extra="The sender pays 10,101 sats." />);
  expect(screen.getByText('Lightning invoice · Bark')).toBeTruthy();
  expect(screen.queryByText(invoice)).toBeNull();
  fireEvent.press(screen.getByLabelText('Show the full Lightning invoice'));
  expect(screen.getByText(invoice)).toBeTruthy();
  expect(screen.getByText('The sender pays 10,101 sats.')).toBeTruthy();
});
