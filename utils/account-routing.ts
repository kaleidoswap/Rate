/**
 * Account Routing — determines which protocols can handle which assets and destinations.
 * Ported from rate-extension/src/lib/account-routing.ts + route-resolver.ts
 */

export type AccountId = 'RGB' | 'SPARK' | 'ARKADE'
export type AssetFamily = 'BTC' | 'RGB' | 'SPARK' | 'ARKADE'
export type TransferMethod = 'bitcoin_l1' | 'lightning' | 'spark' | 'arkade' | 'boarding' | 'submarine_swap'
export type DestinationKind =
  | 'unknown' | 'bitcoin' | 'spark' | 'arkade'
  | 'lightning' | 'lightning-address' | 'lnurl-pay'
  | 'rgb' | 'invalid'

export type NetworkType = 'onchain' | 'lightning' | 'spark' | 'arkade'

export interface RouteResolverAccounts {
  RGB: boolean
  SPARK: boolean
  ARKADE: boolean
}

export interface RouteOption {
  account: AccountId
  method: TransferMethod
  summary: string
  recommended: boolean
}

export interface ResolvedSendRoute extends RouteOption {
  protocol: AccountId
}

export interface MethodMeta {
  id: TransferMethod
  label: string
  summary: string
  eta: string
  feeHint: string
}

export const METHOD_META: Record<TransferMethod, MethodMeta> = {
  bitcoin_l1: { id: 'bitcoin_l1', label: 'Bitcoin address', summary: 'Standard on-chain BTC transfer.', eta: 'slower settlement', feeHint: 'on-chain fee' },
  lightning: { id: 'lightning', label: 'Lightning invoice', summary: 'Fast payment over Lightning.', eta: 'instant when liquidity is available', feeHint: 'low routing fee' },
  spark: { id: 'spark', label: 'Spark transfer', summary: 'Funds land directly in the Spark account.', eta: 'instant', feeHint: 'minimal network fee' },
  arkade: { id: 'arkade', label: 'Arkade transfer', summary: 'Funds land directly in the Arkade account.', eta: 'fast', feeHint: 'account fee' },
  boarding: { id: 'boarding', label: 'Boarding', summary: 'Send on-chain BTC into Arkade.', eta: '1+ confirmations', feeHint: 'on-chain fee' },
  submarine_swap: { id: 'submarine_swap', label: 'LN via swap', summary: 'Uses Arkade as the source account and bridges to Lightning.', eta: 'quote then settlement', feeHint: 'swap + routing fee' },
}

// ========================================================================
// Asset family classification
// ========================================================================

export function getAssetFamily(assetId: string, ticker?: string | null): AssetFamily {
  if (assetId === 'BTC') return 'BTC'
  const normalized = (ticker || '').trim().toUpperCase()
  if (normalized.startsWith('SPARK')) return 'SPARK'
  if (normalized.startsWith('ARK')) return 'ARKADE'
  return 'RGB'
}

// ========================================================================
// Destination classification
// ========================================================================

export function classifyWithdrawDestination(input: string): DestinationKind {
  if (!input.trim()) return 'unknown'
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

  if (lower.startsWith('lnurl1') || lower.startsWith('lightning:lnurl1')) return 'lnurl-pay'
  if (lower.startsWith('ln')) return 'lightning'
  if (lower.startsWith('rgb:') || lower.startsWith('rgb1')) return 'rgb'
  // Arkade: ark1/tark1 + bech32m chars (at least 20 chars total)
  if (/^(ark|tark)1[a-z0-9]{20,}$/i.test(trimmed)) return 'arkade'
  // Spark: spark1/sparkt1/sp1/spt1 etc + bech32m chars (at least 20 chars total)
  if (/^(spark(t|rt|s|l)?|sp(t|rt|s|l)?)1[a-z0-9]{20,}$/i.test(trimmed)) return 'spark'
  if (lower.startsWith('bc1') || lower.startsWith('tb1') || lower.startsWith('bcrt1')) return 'bitcoin'
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) return 'lightning-address'

  return 'invalid'
}

// ========================================================================
// Receive routing
// ========================================================================

export function getReceiveMethodsForAccount(account: AccountId, assetFamily: AssetFamily): TransferMethod[] {
  if (assetFamily === 'RGB') return ['bitcoin_l1', 'lightning']
  if (assetFamily === 'SPARK') return ['spark']
  if (assetFamily === 'ARKADE') return ['arkade']

  switch (account) {
    case 'RGB': return ['bitcoin_l1', 'lightning']
    case 'SPARK': return ['spark', 'lightning']
    case 'ARKADE': return ['arkade', 'boarding']
  }
}

export function resolveReceiveAccounts(args: {
  assetFamily: AssetFamily
  accounts: RouteResolverAccounts
}): AccountId[] {
  const { assetFamily, accounts } = args
  switch (assetFamily) {
    case 'SPARK': return accounts.SPARK ? ['SPARK'] : []
    case 'ARKADE': return accounts.ARKADE ? ['ARKADE'] : []
    case 'RGB': return accounts.RGB ? ['RGB'] : []
    case 'BTC':
    default:
      return [
        ...(accounts.RGB ? ['RGB' as const] : []),
        ...(accounts.SPARK ? ['SPARK' as const] : []),
        ...(accounts.ARKADE ? ['ARKADE' as const] : []),
      ]
  }
}

export function getNetworkTypesForAccount(account: AccountId, assetFamily: AssetFamily): NetworkType[] {
  const methods = getReceiveMethodsForAccount(account, assetFamily)
  return methods.map(m => {
    switch (m) {
      case 'bitcoin_l1': return 'onchain'
      case 'lightning': return 'lightning'
      case 'spark': return 'spark'
      case 'arkade': return 'arkade'
      case 'boarding': return 'arkade'
      default: return 'onchain'
    }
  }).filter((v, i, a) => a.indexOf(v) === i) as NetworkType[]
}

// ========================================================================
// Send routing
// ========================================================================

export function getSendRouteSummary(
  account: AccountId,
  destinationType: DestinationKind,
): { method: TransferMethod; summary: string } | null {
  if (destinationType === 'invalid' || destinationType === 'unknown') return null

  if (destinationType === 'spark') {
    if (account !== 'SPARK') return null
    return { method: 'spark', summary: 'Transfers directly to a Spark address.' }
  }

  if (destinationType === 'bitcoin') {
    if (account === 'ARKADE') return { method: 'boarding', summary: 'Offboards from Arkade to a Bitcoin address.' }
    return {
      method: 'bitcoin_l1',
      summary: account === 'SPARK' ? 'Bridges Spark BTC to a Bitcoin address.' : 'Sends BTC on-chain from RGB & Lightning.',
    }
  }

  if (destinationType === 'lightning' || destinationType === 'lightning-address' || destinationType === 'lnurl-pay') {
    if (account === 'ARKADE') return { method: 'submarine_swap', summary: 'Uses Arkade and completes the payment over Lightning via swap.' }
    return {
      method: 'lightning',
      summary: account === 'SPARK' ? 'Pays the Lightning request from Spark.' : 'Pays the Lightning request from RGB & Lightning.',
    }
  }

  if (destinationType === 'arkade') {
    return { method: 'arkade', summary: 'Transfers directly into an Arkade account.' }
  }

  return { method: 'lightning', summary: 'Sends the asset using the only compatible route.' }
}

export function resolveSendRoutes(args: {
  destinationType: DestinationKind
  selectedAssetId: string
  accounts: RouteResolverAccounts
}): { routes: RouteOption[]; recommended?: RouteOption } {
  const { destinationType, selectedAssetId, accounts } = args

  const availableAccounts: AccountId[] =
    selectedAssetId !== 'BTC'
      ? (accounts.RGB ? ['RGB'] : [])
      : destinationType === 'arkade'
        ? (accounts.ARKADE ? ['ARKADE'] : [])
        : destinationType === 'rgb'
          ? (accounts.RGB ? ['RGB'] : [])
          : destinationType === 'spark'
            ? (accounts.SPARK ? ['SPARK'] : [])
            : destinationType === 'lightning' || destinationType === 'lightning-address' || destinationType === 'lnurl-pay'
              ? [
                  ...(accounts.SPARK ? ['SPARK' as const] : []),
                  ...(accounts.RGB ? ['RGB' as const] : []),
                  ...(accounts.ARKADE ? ['ARKADE' as const] : []),
                ]
              : destinationType === 'bitcoin'
                ? [
                    ...(accounts.RGB ? ['RGB' as const] : []),
                    ...(accounts.SPARK ? ['SPARK' as const] : []),
                    ...(accounts.ARKADE ? ['ARKADE' as const] : []),
                  ]
                : []

  const recommendedAccount: AccountId | undefined =
    selectedAssetId !== 'BTC'
      ? (accounts.RGB ? 'RGB' : undefined)
      : destinationType === 'arkade'
        ? (accounts.ARKADE ? 'ARKADE' : undefined)
        : destinationType === 'spark'
          ? (accounts.SPARK ? 'SPARK' : undefined)
          : destinationType === 'lightning' || destinationType === 'lightning-address' || destinationType === 'lnurl-pay'
            ? (accounts.SPARK ? 'SPARK' : accounts.RGB ? 'RGB' : accounts.ARKADE ? 'ARKADE' : undefined)
            : destinationType === 'bitcoin'
              ? (accounts.RGB ? 'RGB' : accounts.SPARK ? 'SPARK' : accounts.ARKADE ? 'ARKADE' : undefined)
              : undefined

  const routes = availableAccounts.flatMap(account => {
    const summary = getSendRouteSummary(account, destinationType)
    if (!summary) return []
    return [{ account, method: summary.method, summary: summary.summary, recommended: recommendedAccount === account }]
  })

  return { routes, recommended: routes.find(r => r.recommended) }
}

export function resolveActiveSendRoute(args: {
  destinationType: DestinationKind
  selectedAssetId: string
  accounts: RouteResolverAccounts
  preferredAccount?: AccountId | null
}): ResolvedSendRoute | undefined {
  const { preferredAccount } = args
  const resolved = resolveSendRoutes(args)
  const selected =
    (preferredAccount ? resolved.routes.find(r => r.account === preferredAccount) : undefined)
    ?? resolved.recommended ?? resolved.routes[0]
  if (!selected) return undefined
  return { ...selected, protocol: selected.account }
}
