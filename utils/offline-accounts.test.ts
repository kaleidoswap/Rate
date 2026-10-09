import { failedAccounts, offlineAccountNames } from './offline-accounts'

test('only real startup failures count, never a skipped account', () => {
  const results = new Map([
    ['SPARK', { success: true }],
    ['RGB_LN', { success: false, error: 'skipped: no NWC connection string configured' }],
    ['RGB_L1', { success: false, error: "Couldn't restore your RGB backup (timeout)." }],
    ['ARKADE', { success: false, error: 'boom' }],
  ])
  expect(failedAccounts(results)).toEqual(['RGB_L1', 'ARKADE'])
})

test('an account that connected after startup is no longer offline', () => {
  expect(offlineAccountNames(['RGB_L1', 'ARKADE'], () => false)).toEqual(['RGB on this phone', 'Arkade'])
  expect(offlineAccountNames(['RGB_L1', 'ARKADE'], (p) => p === 'RGB_L1')).toEqual(['Arkade'])
})

test('RGB on this phone has a readable name', () => {
  expect(offlineAccountNames(['RGB_L1'], () => false)).toEqual(['RGB on this phone'])
})
