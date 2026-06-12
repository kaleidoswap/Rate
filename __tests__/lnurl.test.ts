// LNURL-pay resolution: bech32 LNURL decode (LUD-06) + Lightning address
// (LUD-16) → BOLT11 invoice. Regression coverage for the Send/Scan flow bug
// where bech32 `lnurl1...` destinations could never be paid.

import { decodeLnurlBech32, resolveLightningAddressToInvoice } from '../utils/lnurl';

// Official LUD-06 test vector.
const LNURL_VECTOR =
  'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS';
const LNURL_VECTOR_URL =
  'https://service.com/api?q=3fc3645b439ce8e7f2553a69e5267081d96dcd340693afabe04be7b0ccd178df';

const jsonResponse = (body: any) => ({
  ok: true,
  json: async () => body,
});

describe('decodeLnurlBech32', () => {
  it('decodes the LUD-06 test vector (uppercase QR form)', () => {
    expect(decodeLnurlBech32(LNURL_VECTOR)).toBe(LNURL_VECTOR_URL);
  });

  it('decodes lowercase input', () => {
    expect(decodeLnurlBech32(LNURL_VECTOR.toLowerCase())).toBe(LNURL_VECTOR_URL);
  });
});

describe('resolveLightningAddressToInvoice', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('resolves a bech32 LNURL to an invoice via its decoded URL', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        tag: 'payRequest',
        callback: 'https://service.com/api/pay',
        minSendable: 1000,
        maxSendable: 100000000,
      }))
      .mockResolvedValueOnce(jsonResponse({ pr: 'lnbc1invoice' }));

    const pr = await resolveLightningAddressToInvoice(LNURL_VECTOR, 21);
    expect(pr).toBe('lnbc1invoice');
    expect(fetchMock.mock.calls[0][0]).toBe(LNURL_VECTOR_URL);
    expect(fetchMock.mock.calls[1][0]).toContain('https://service.com/api/pay?amount=21000');
  });

  it('resolves a Lightning address via the well-known endpoint (lowercased)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        tag: 'payRequest',
        callback: 'https://getalby.com/lnurlp/walter/callback',
        minSendable: 1000,
        maxSendable: 100000000,
      }))
      .mockResolvedValueOnce(jsonResponse({ pr: 'lnbc1invoice' }));

    const pr = await resolveLightningAddressToInvoice('WALTER@GETALBY.COM', 100);
    expect(pr).toBe('lnbc1invoice');
    expect(fetchMock.mock.calls[0][0]).toBe('https://getalby.com/.well-known/lnurlp/walter');
  });

  it('unwraps a lightning: URI prefix', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ tag: 'payRequest', callback: 'https://x.com/cb' }))
      .mockResolvedValueOnce(jsonResponse({ pr: 'lnbc1invoice' }));

    const pr = await resolveLightningAddressToInvoice(`lightning:${LNURL_VECTOR}`, 21);
    expect(pr).toBe('lnbc1invoice');
    expect(fetchMock.mock.calls[0][0]).toBe(LNURL_VECTOR_URL);
  });

  it('rejects LNURL-withdraw codes with a clear error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tag: 'withdrawRequest', callback: 'https://x.com/cb' }));
    await expect(resolveLightningAddressToInvoice(LNURL_VECTOR, 21))
      .rejects.toThrow(/LNURL-withdraw/);
  });

  it('enforces minSendable / maxSendable limits', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      tag: 'payRequest',
      callback: 'https://x.com/cb',
      minSendable: 10000,
      maxSendable: 20000,
    }));
    await expect(resolveLightningAddressToInvoice(LNURL_VECTOR, 5)).rejects.toThrow(/Minimum is 10 sats/);
    await expect(resolveLightningAddressToInvoice(LNURL_VECTOR, 50)).rejects.toThrow(/Maximum is 20 sats/);
  });

  it('rejects input that is neither a Lightning address nor an LNURL', async () => {
    await expect(resolveLightningAddressToInvoice('bc1qsomeonchainaddress', 21))
      .rejects.toThrow(/doesn't look like a Lightning address or LNURL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a positive amount', async () => {
    await expect(resolveLightningAddressToInvoice('walter@getalby.com', 0))
      .rejects.toThrow(/Enter an amount/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
