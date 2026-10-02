/** Read only networks explicitly encoded in a request. tb1 does not distinguish
 * Bitcoin testnet from Signet, and offers/LNURL need provider resolution. */
export function paymentNetworks(request: string): string[] {
  const value = request.trim().replace(/^lightning:(\/\/)?/i, '').toLowerCase();
  if (value.startsWith('bitcoin:')) {
    const [address, query = ''] = value.slice(8).split('?');
    const networks = paymentNetworks(address);
    const params = new URLSearchParams(query);
    for (const key of ['lightning', 'spark', 'ark']) {
      const method = params.get(key);
      if (method) networks.push(...paymentNetworks(method));
    }
    return [...new Set(networks)];
  }
  if (/^(sparkrt|sprt)1/.test(value)) return ['Regtest'];
  if (/^sparkt1/.test(value)) return ['Testnet'];
  if (/^(spark1|ark1)/.test(value)) return ['Mainnet'];
  if (/^tark1/.test(value)) return ['Testnet / Signet'];
  if (/^(lnbcrt|bcrt1)/.test(value)) return ['Regtest'];
  if (/^(lntbs)/.test(value)) return ['Signet'];
  if (/^(lntb|tb1)/.test(value)) return ['Testnet / Signet'];
  if (/^(lnbc|bc1)/.test(value)) return ['Mainnet'];
  return [];
}

export function paymentRequestLabel(request: string): string {
  const value = request.trim().toLowerCase();
  if (value.startsWith('bitcoin:') && /[?&](lightning|spark|ark)=/.test(value)) return 'Multi-method payment request';
  if (/^(lightning:)?ln(bc|tb|bcrt)/.test(value)) return 'Lightning invoice';
  if (/^(lightning:)?lno1/.test(value)) return 'Lightning offer';
  if (/^(bitcoin:|bc1|tb1|bcrt1)/.test(value)) return 'Bitcoin address';
  return 'Payment request';
}
