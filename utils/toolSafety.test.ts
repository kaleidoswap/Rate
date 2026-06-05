import { isLikelyValueMovingToolName } from './toolSafety';

describe('isLikelyValueMovingToolName', () => {
  it('flags the known value-moving tools', () => {
    expect(isLikelyValueMovingToolName('pay_lightning_invoice')).toBe(true);
    expect(isLikelyValueMovingToolName('pay_nostr_contact')).toBe(true);
  });

  it('flags plausible future fund-moving tools (the fail-safe target)', () => {
    for (const name of [
      'send_payment',
      'send_asset',
      'send_btc',
      'withdraw_funds',
      'execute_swap',
      'zap_contact',
      'keysend',
      'open_channel',
      'close_channel',
      'mint_asset',
      'issue_asset',
      'sign_psbt',
    ]) {
      expect(isLikelyValueMovingToolName(name)).toBe(true);
    }
  });

  it('does NOT flag read-only / receive tools', () => {
    for (const name of [
      'get_wallet_balance',
      'get_receive_address',
      'generate_invoice',
      'list_recent_transactions',
      'list_sent_payments',
      'find_merchant_locations',
      'get_merchant_info',
      'get_quote',
      'estimate_fee',
    ]) {
      expect(isLikelyValueMovingToolName(name)).toBe(false);
    }
  });

  it('is defensive about empty/garbage input', () => {
    expect(isLikelyValueMovingToolName('')).toBe(false);
    // @ts-expect-error runtime resilience
    expect(isLikelyValueMovingToolName(undefined)).toBe(false);
  });
});
