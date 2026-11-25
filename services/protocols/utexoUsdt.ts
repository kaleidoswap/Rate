/** Utexo BFA RGB contract IDs are case-sensitive and scoped to the Bitcoin network. */
export const UTEXO_USDT = {
  signet: 'rgb:uVMNCuVU-U00Y_wv-6~7ZbW7-tEuUMcE-pB0wDzC-nt7Qsdc',
  mainnet: 'rgb:A6Nr_ndv-Cx_t3_i-YfPXoL6-pT8ibp3-CR6LH5q-fQvTsp8',
} as const

export function utexoUsdtContract(network: string): string | undefined {
  if (network === 'signet' || network === 'mainnet') return UTEXO_USDT[network]
  return undefined
}
