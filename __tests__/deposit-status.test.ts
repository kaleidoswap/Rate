import { normalizeDepositStatus } from '../utils/deposit-status';
describe('invoice deposit status', () => {
  test.each(['open', 'created', 'unpaid', 'pending', 'not_paid', 'unsettled'])('%s is not a detected deposit', state => {
    expect(normalizeDepositStatus(state)).toBe('watching');
  });
  test.each(['paid', 'settled', 'confirmed'])('%s confirms funds', state => {
    expect(normalizeDepositStatus(state)).toBe('confirmed');
  });
  test.each(['not_confirmed', 'payment_unpaid', 'unknown', undefined])('unknown %s never implies success', state => {
    expect(normalizeDepositStatus(state)).toBeNull();
  });
  it('distinguishes an in-flight payment from an expired request', () => {
    expect(normalizeDepositStatus('inflight')).toBe('pending');
    expect(normalizeDepositStatus('expired')).toBe('expired');
  });
});
