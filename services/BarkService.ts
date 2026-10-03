import type { PaymentRequest } from '@kaleidorg/wallet-engine'
import type { BarkReactNativeAdapter } from '@kaleidorg/wallet-engine/adapters/bark-react-native'
import { protocolManager } from './protocols'
import { currentBarkHost } from './protocols/barkPreferences'
import { throttledSync } from '../utils/throttled-sync'

export const barkNetworkLabel = () => currentBarkHost()?.network === 'mainnet' ? 'Mainnet' : currentBarkHost()?.network === 'signet' ? 'Signet · test sats' : 'Not configured'

export function getConnectedBark(): BarkReactNativeAdapter {
  const adapter = protocolManager.getAdapterIfAvailable('BARK') as BarkReactNativeAdapter | undefined
  if (!adapter?.isConnected()) throw new Error('Bark is not connected. Return to the dashboard to connect your wallet.')
  return adapter
}

// Bark runs without its background daemon: incoming Ark payments, Lightning receives
// (claimed during sync) and in-flight Lightning sends only move forward when the app
// syncs. A sync blocks other Bark calls while it runs, so watchers share a throttled one.
const BARK_SYNC_INTERVAL_MS = 5_000
const barkSyncs = new WeakMap<object, () => Promise<void>>()

/** Syncs the connected Bark wallet so new receives and send outcomes become visible. No-op without Bark. */
export function syncBarkForUpdates(): Promise<void> {
  const adapter = protocolManager.getAdapterIfAvailable('BARK') as BarkReactNativeAdapter | undefined
  if (!adapter?.isConnected()) return Promise.resolve()
  let sync = barkSyncs.get(adapter)
  if (!sync) {
    sync = throttledSync(() => adapter.backend.sync(), BARK_SYNC_INTERVAL_MS)
    barkSyncs.set(adapter, sync)
  }
  return sync()
}

export async function readBarkAccount(sync = false) {
  const adapter = getConnectedBark()
  if (sync) {
    await adapter.backend.sync()
    await adapter.backend.syncOnchain()
  }
  const [info, balance, onchain, transactions] = await Promise.all([
    adapter.backend.getWalletInfo(), adapter.backend.getBalance(),
    adapter.backend.getOnchainBalance(), adapter.listTransactions({ limit: 50 }),
  ])
  return { info, balance, onchain, transactions }
}

export async function createBarkReceive(kind: 'ark' | 'lightning' | 'onchain', sats?: number) {
  const adapter = getConnectedBark()
  if (kind === 'ark') return (await adapter.getReceiveAddress()).address
  if (kind === 'onchain') return adapter.backend.getOnchainAddress()
  if (!Number.isSafeInteger(sats) || !sats || sats <= 0) throw new Error('Enter a positive whole number of sats.')
  return (await adapter.createInvoice({ amount: sats, layer: 'BTC_LN' })).invoice
}

/** Use the manager's send policy without permanently changing the selected account. */
export async function sendBarkPayment(request: PaymentRequest) {
  getConnectedBark()
  const previous = protocolManager.getActiveProtocol()
  await protocolManager.setActiveProtocol('BARK')
  // The manager captures the active adapter synchronously when invoked.
  const payment = protocolManager.sendPayment(request)
  if (previous && previous !== 'BARK') {
    // Restoration must never mask a submitted payment or encourage a retry.
    void protocolManager.setActiveProtocol(previous).catch(() => {})
  }
  return payment
}

/** Bark's separate on-chain (boarding) wallet balance. */
export async function readBarkOnchain(): Promise<{ confirmedSats: number; pendingSats: number }> {
  const adapter = getConnectedBark()
  await adapter.backend.syncOnchain()
  const { confirmedSats, pendingSats } = await adapter.backend.getOnchainBalance()
  return { confirmedSats, pendingSats }
}

/** Bark's recovery state after opening/restoring a wallet. */
export async function readBarkRecovery(): Promise<string | null> {
  const adapter = protocolManager.getAdapterIfAvailable('BARK') as BarkReactNativeAdapter | undefined
  if (!adapter?.isConnected()) return null
  const info: any = await adapter.backend.getWalletInfo()
  return info?.recovery ?? null
}

/**
 * sendBarkPayment with a time limit. Bark can wait on Lightning settlement with
 * no limit (BOLT12 offers), which froze Send. Past `timeoutMs` this resolves as
 * `pending` (with the invoice's payment hash when known) so the receipt can keep
 * following it. It never reports a failure on timeout: the payment may still be
 * in flight, and "failed" invites a double payment.
 */
export async function sendBarkPaymentBounded(
  request: PaymentRequest,
  timeoutMs: number,
  paymentHash?: string | null,
): Promise<any> {
  const sending = sendBarkPayment(request)
  sending.catch(() => { /* an outcome after the timeout is followed by the receipt */ })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<any>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending', paymentHash: paymentHash ?? '', timedOut: true }), timeoutMs)
  })
  try {
    return await Promise.race([sending, timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function getBarkBoardingTerms() {
  return getConnectedBark().boardingTerms()
}

export async function boardBarkFunds(sats: number) {
  if (!Number.isSafeInteger(sats) || sats <= 0) throw new Error('Enter a positive whole number of sats.')
  return getConnectedBark().boardAmount(sats)
}
