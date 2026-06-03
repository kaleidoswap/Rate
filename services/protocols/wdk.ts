/**
 * WDK Protocol Wiring — KaleidoSwap App
 * -------------------------------------
 * Parallel to ./index.ts (native adapters), this wires the WDK-backed adapters
 * (@kaleidorg/wallet-protocols `*WdkAdapter`) into a ProtocolManager.
 *
 * Two RN-specific concerns are handled here:
 *  1. Module loading: WDK adapters call `loadWdkModule()`, which we satisfy with a
 *     STATIC `require()` per package (Metro can't follow dynamic import of these).
 *     Each require is guarded so missing modules just disable that protocol.
 *  2. Config shapes: builds each adapter's config from the wallet's NetworkConfig.
 *
 * Enabled via EXPO_PUBLIC_WALLET_ENGINE=wdk (see ./index.ts). Default stays native.
 */

import {
  ProtocolManager,
  registerWdkModule,
  SparkWdkAdapter,
  LiquidWdkAdapter,
  RlnWdkAdapter,
  ArkadeWdkAdapter,
  networkTypeToProtocol,
} from '@kaleidorg/wallet-protocols'
import type {
  ProtocolType,
  SparkAdapterConfig,
  LiquidAdapterConfig,
  RlnAdapterConfig,
  ArkadeAdapterConfig,
} from '@kaleidorg/wallet-protocols'

/**
 * Register static-require loaders for each WDK package that's installed.
 * Adapters fall back to dynamic import if a loader is missing (works off-device).
 */
function registerWdkModuleLoaders(): void {
  const tryRegister = (pkg: string, load: () => any) => {
    try {
      // Probe once so we only register loaders for installed packages.
      load()
      registerWdkModule(pkg, load)
      console.log(`[wdk] module available: ${pkg}`)
    } catch (e) {
      console.warn(`[wdk] module NOT installed: ${pkg}`)
    }
  }
  tryRegister('@tetherto/wdk-wallet-spark', () => require('@tetherto/wdk-wallet-spark'))
  tryRegister('@kaleidorg/wdk-wallet-liquid', () => require('@kaleidorg/wdk-wallet-liquid'))
  tryRegister('@kaleidorg/wdk-wallet-rln', () => require('@kaleidorg/wdk-wallet-rln'))
  tryRegister('@arkade-os/wdk', () => require('@arkade-os/wdk'))
  tryRegister('@kaleidorg/wdk-protocol-swap-kaleidoswap', () =>
    require('@kaleidorg/wdk-protocol-swap-kaleidoswap'),
  )
}

let _wdkManager: ProtocolManager | null = null

export function getWdkProtocolManager(): ProtocolManager {
  if (!_wdkManager) {
    registerWdkModuleLoaders()
    _wdkManager = new ProtocolManager()
    _wdkManager.registerAdapter(new SparkWdkAdapter())
    _wdkManager.registerAdapter(new LiquidWdkAdapter())
    _wdkManager.registerAdapter(new RlnWdkAdapter())
    _wdkManager.registerAdapter(new ArkadeWdkAdapter())
  }
  return _wdkManager
}

/**
 * Connect the enabled WDK protocols from the wallet's network configs.
 * Mirrors initializeProtocols() in ./index.ts but produces WDK adapter configs.
 */
export async function initializeWdkProtocols(
  mnemonic: string,
  networkConfigs: Array<{ type: string; enabled: boolean; config?: string }>,
): Promise<Map<ProtocolType, { success: boolean; error?: string }>> {
  const manager = getWdkProtocolManager()
  const results = new Map<ProtocolType, { success: boolean; error?: string }>()

  for (const nc of networkConfigs) {
    if (!nc.enabled) continue
    const protocol = networkTypeToProtocol(nc.type as any)
    if (!protocol) continue

    const existing = manager.getAdapterIfAvailable(protocol)
    if (existing?.isConnected()) {
      results.set(protocol, { success: true })
      continue
    }

    try {
      const parsed = nc.config ? JSON.parse(nc.config) : {}
      let config: any

      switch (protocol) {
        case 'SPARK':
          config = {
            protocol: 'SPARK',
            mnemonic,
            network: parsed.network || 'mainnet',
          } as SparkAdapterConfig
          break

        case 'LIQUID':
          config = {
            protocol: 'LIQUID',
            mnemonic,
            network: parsed.network || 'mainnet',
            esploraUrl: parsed.esploraUrl,
          } as LiquidAdapterConfig
          break

        case 'ARKADE':
          config = {
            protocol: 'ARKADE',
            mnemonic,
            network: parsed.network || 'signet',
            arkadeConfig: {
              arkServerUrl: parsed.arkServerUrl || 'https://signet.arkade.sh',
              esploraUrl: parsed.esploraUrl,
              ...(parsed.arkadeConfig || {}),
            },
          } as ArkadeAdapterConfig
          break

        case 'RGB': {
          const nodeUrl =
            parsed.type === 'remote' ? parsed.url : parsed.nodeUrl || 'http://127.0.0.1:3000'
          if (!nodeUrl) {
            results.set(protocol, { success: false, error: 'skipped: no node URL configured' })
            continue
          }
          config = {
            protocol: 'RGB',
            mnemonic,
            nodeUrl,
            network: parsed.network || 'regtest',
          } as RlnAdapterConfig
          break
        }

        default:
          continue
      }

      await manager.connect(protocol, config)
      results.set(protocol, { success: true })
      console.log(`[initializeWdkProtocols] ${protocol} connected`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[initializeWdkProtocols] ${protocol} failed:`, msg)
      results.set(protocol, { success: false, error: msg })
    }
  }

  return results
}
