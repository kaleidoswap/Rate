import type { PaymentRequest } from '@kaleidorg/wallet-engine'
import type { BarkReactNativeAdapter } from '@kaleidorg/wallet-engine/adapters/bark-react-native'
import { protocolManager } from './protocols'
import { resolveBarkHostConfig } from './protocols/bark'

export const barkNetworkLabel = () => resolveBarkHostConfig()?.network === 'mainnet' ? 'Mainnet' : 'Signet · test sats'

export function getConnectedBark(): BarkReactNativeAdapter {
  const adapter = protocolManager.getAdapterIfAvailable('BARK') as BarkReactNativeAdapter | undefined
  if (!adapter?.isConnected()) throw new Error('Bark is not connected. Return to the dashboard to connect your wallet.')
  return adapter
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

export async function getBarkBoardingTerms() {
  return getConnectedBark().boardingTerms()
}

export async function boardBarkFunds(sats: number) {
  if (!Number.isSafeInteger(sats) || sats <= 0) throw new Error('Enter a positive whole number of sats.')
  return getConnectedBark().boardAmount(sats)
}
