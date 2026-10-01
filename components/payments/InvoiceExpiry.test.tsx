import { invoiceExpiry } from './InvoiceExpiry';
import { decode } from 'light-bolt11-decoder';
jest.mock('light-bolt11-decoder', () => ({ decode: jest.fn() }));
test('uses invoice timestamp and expiry, never time since opening the screen', () => {
  (decode as jest.Mock).mockReturnValue({ sections: [{ name: 'timestamp', value: 1000 }, { name: 'expiry', value: 120 }] });
  expect(invoiceExpiry('lnbc-invoice')).toBe(1120000);
  expect(invoiceExpiry('bc1-address')).toBeNull();
});
test('uses the BOLT11 default only for a missing expiry field and rejects malformed invoices', () => {
  (decode as jest.Mock).mockReturnValue({ sections: [{ name: 'timestamp', value: 1000 }] });
  expect(invoiceExpiry('lnbc-invoice')).toBe(4600000);
  (decode as jest.Mock).mockReturnValue({ sections: [] }); expect(invoiceExpiry('lnbc-bad')).toBeNull();
  (decode as jest.Mock).mockImplementation(() => { throw new Error('invalid'); }); expect(invoiceExpiry('lnbc-bad')).toBeNull();
});
