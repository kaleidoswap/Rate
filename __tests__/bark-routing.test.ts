import { classifyWithdrawDestination, resolveSendRoutes, resolveActiveSendRoute, resolveReceiveAccounts } from '../utils/account-routing'
const accounts = { RGB: true, SPARK: true, ARKADE: true, BARK: true }

describe('Bark account routing', () => {
  it('requires explicit account selection for the shared Ark address prefix', () => {
    const destinationType = classifyWithdrawDestination('tark1' + 'q'.repeat(40))
    const args = { destinationType, selectedAssetId: 'BTC', accounts }
    expect(resolveSendRoutes(args).routes.map(r => r.account)).toEqual(['ARKADE', 'BARK'])
    expect(resolveActiveSendRoute(args)).toBeUndefined()
    expect(resolveActiveSendRoute({ ...args, preferredAccount: 'BARK' })?.protocol).toBe('BARK')
  })
  it.each(['bitcoin', 'lightning', 'lightning-address', 'lnurl-pay'] as const)('can explicitly pay %s from Bark', destinationType => {
    const route = resolveActiveSendRoute({ destinationType, selectedAssetId: 'BTC', accounts, preferredAccount: 'BARK' })
    expect(route?.account).toBe('BARK')
    expect(route?.summary).toContain('Bark')
  })
  it('does not silently fall back to a different account when Bark disconnects', () => {
    expect(resolveActiveSendRoute({ destinationType: 'lightning', selectedAssetId: 'BTC', accounts: { ...accounts, BARK: false }, preferredAccount: 'BARK' })).toBeUndefined()
  })
  it('does not offer Bark for tokens or Spark destinations', () => {
    expect(resolveSendRoutes({ destinationType: 'lightning', selectedAssetId: 'rgb:token', accounts }).routes.map(r => r.account)).toEqual(['RGB'])
    expect(resolveSendRoutes({ destinationType: 'spark', selectedAssetId: 'BTC', accounts }).routes.map(r => r.account)).toEqual(['SPARK'])
  })
  it('exposes Bark only for BTC receive accounts', () => {
    expect(resolveReceiveAccounts({ assetFamily: 'BTC', accounts })).toContain('BARK')
    expect(resolveReceiveAccounts({ assetFamily: 'RGB', accounts })).not.toContain('BARK')
  })
})
