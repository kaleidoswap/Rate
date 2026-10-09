import { DEFAULT_POLICY, evaluateSpend, normalizePolicy, normalizeService, policyProblem, type SpendingPolicy } from './policy';

const policy = (patch: Partial<SpendingPolicy> = {}): SpendingPolicy => ({
  perPaymentSats: 1000, dailySats: 3000, monthlySats: 10_000, autoApproveSats: 100,
  allowedServices: ['api.example.com'], paused: false, ...patch,
});
const none = { todaySats: 0, monthSats: 0 };
const req = (amountSats: number, service = 'api.example.com', feeSats = 0) => ({ amountSats, feeSats, service });

describe('evaluateSpend', () => {
  it('pays small amounts to allowed services without asking', () => {
    expect(evaluateSpend(policy(), none, req(50))).toEqual({ kind: 'auto' });
    expect(evaluateSpend(policy(), none, req(50, 'https://API.example.com/v1/feed'))).toEqual({ kind: 'auto' });
  });

  it('asks at or above the threshold, and fees count', () => {
    expect(evaluateSpend(policy(), none, req(100)).kind).toBe('confirm');
    expect(evaluateSpend(policy(), none, req(95, 'api.example.com', 5)).kind).toBe('confirm');
    expect(evaluateSpend(policy({ autoApproveSats: 0 }), none, req(1)).kind).toBe('confirm');
  });

  it('asks for services that are not allowed, and an empty list always asks', () => {
    expect(evaluateSpend(policy(), none, req(10, 'other.example.org'))).toMatchObject({ kind: 'confirm', reason: expect.stringContaining('other.example.org') });
    expect(evaluateSpend(policy({ allowedServices: [] }), none, req(1)).kind).toBe('confirm');
    expect(evaluateSpend(policy(), none, req(10, 'evil-api.example.com')).kind).toBe('confirm');
    expect(evaluateSpend(policy(), none, req(10, 'api.example.com.evil.io')).kind).toBe('confirm');
  });

  it('refuses over the per-payment limit even with approval', () => {
    expect(evaluateSpend(policy(), none, req(1001))).toMatchObject({ kind: 'deny', code: 'per_payment_limit' });
    expect(evaluateSpend(policy(), none, req(995, 'api.example.com', 6))).toMatchObject({ kind: 'deny', code: 'per_payment_limit' });
  });

  it('enforces the daily and monthly windows', () => {
    expect(evaluateSpend(policy(), { todaySats: 2500, monthSats: 2500 }, req(500)).kind).toBe('confirm');
    expect(evaluateSpend(policy(), { todaySats: 2501, monthSats: 2501 }, req(500))).toMatchObject({ kind: 'deny', code: 'daily_limit' });
    expect(evaluateSpend(policy(), { todaySats: 0, monthSats: 9950 }, req(51))).toMatchObject({ kind: 'deny', code: 'monthly_limit' });
  });

  it('refuses when paused or short of funds', () => {
    expect(evaluateSpend(policy({ paused: true }), none, req(1))).toMatchObject({ kind: 'deny', code: 'paused' });
    expect(evaluateSpend(policy(), none, req(50), 49)).toMatchObject({ kind: 'deny', code: 'insufficient_balance' });
    expect(evaluateSpend(policy(), none, req(50), 50)).toEqual({ kind: 'auto' });
  });

  it('fails closed on anything malformed', () => {
    for (const bad of [null, undefined, 'x', {}, { ...policy(), dailySats: -1 }, { ...policy(), perPaymentSats: 1.5 },
      { ...policy(), monthlySats: Infinity }, { ...policy(), paused: 'no' }, { ...policy(), allowedServices: ['ok.com', 'bad host'] }]) {
      expect(evaluateSpend(bad, none, req(1)).kind).toBe('deny');
    }
    for (const bad of [null, { amountSats: 0, feeSats: 0, service: 'a.com' }, { amountSats: NaN, feeSats: 0, service: 'a.com' },
      { amountSats: 10, feeSats: -1, service: 'a.com' }, { amountSats: 10, feeSats: 0, service: '' }, { amountSats: '10', feeSats: 0, service: 'a.com' }]) {
      expect(evaluateSpend(policy(), none, bad).kind).toBe('deny');
    }
    expect(evaluateSpend(policy(), null, req(1)).kind).toBe('deny');
    expect(evaluateSpend(policy(), { todaySats: NaN, monthSats: 0 }, req(1)).kind).toBe('deny');
    expect(evaluateSpend(policy(), none, req(1), 'lots')).toMatchObject({ kind: 'deny', code: 'insufficient_balance' });
    const throwing = { get perPaymentSats() { throw new Error('boom'); } };
    expect(evaluateSpend(throwing, none, req(1)).kind).toBe('deny');
  });

  it('ignores anything in the request that tries to change the rules', () => {
    const hostile = {
      ...req(5000, 'attacker.example'),
      policy: { perPaymentSats: 10_000_000, allowedServices: ['attacker.example'], autoApproveSats: 10_000_000 },
      allowedServices: ['attacker.example'], autoApprove: true, skipConfirmation: true, perPaymentSats: 10_000_000,
    };
    expect(evaluateSpend(policy(), none, hostile)).toMatchObject({ kind: 'deny', code: 'per_payment_limit' });
    const small = { ...hostile, amountSats: 10 };
    expect(evaluateSpend(policy(), none, small).kind).toBe('confirm');
    const p = policy();
    evaluateSpend(p, none, small);
    expect(p).toEqual(policy());
  });
});

describe('policy helpers', () => {
  it('normalizes services to hosts', () => {
    expect(normalizeService('HTTPS://user:pw@Api.Example.com:8443/x?y')).toBe('api.example.com');
    expect(normalizeService('api.example.com.')).toBe('api.example.com');
    expect(normalizeService('not a host')).toBeNull();
    expect(normalizeService('')).toBeNull();
  });

  it('dedupes and lower-cases allowed services, keeps the defaults valid', () => {
    expect(normalizePolicy({ ...policy(), allowedServices: ['A.com', 'a.com'] })?.allowedServices).toEqual(['a.com']);
    expect(normalizePolicy(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
    expect(policyProblem(DEFAULT_POLICY)).toBeNull();
    expect(policyProblem(policy({ perPaymentSats: 5000 }))).toMatch(/daily/);
    expect(policyProblem(policy({ autoApproveSats: 2000 }))).toMatch(/per-payment/);
  });
});
