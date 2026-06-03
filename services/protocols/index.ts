/**
 * Protocol Layer — KaleidoSwap App Entry Point
 * Re-exports from @kaleidorg/wallet-protocols shared library
 * and provides KaleidoSwap-specific initialization with Expo platform providers.
 */

import {
  ProtocolManager,
  SparkAdapter,
  ArkadeAdapter,
  RgbAdapter,
  sparkClientManager,
  arkadeClientManager,
  networkTypeToProtocol,
} from '@kaleidorg/wallet-protocols'
import type { ProtocolType, SparkConfig, ArkadeConfig, RgbConfig } from '@kaleidorg/wallet-protocols'
import { getWdkProtocolManager, initializeWdkProtocols } from './wdk'

// Configure Spark with SDK factory (avoids dynamic import from wallet-protocols)
try {
  const { SparkWallet } = require('@buildonspark/spark-sdk')
  sparkClientManager.setSdkFactory({
    initializeWallet: (config: any) => SparkWallet.initialize(config),
  })
} catch (err) {
  console.warn('[protocols] @buildonspark/spark-sdk not available:', err)
}

// Configure Arkade with SDK factory + Expo providers for React Native
try {
  const { Wallet, SingleKey } = require('@arkade-os/sdk')

  // SQLite repositories for React Native (replaces IndexedDB)
  let SQLiteWalletRepository: any = null
  let SQLiteContractRepository: any = null
  try {
    const sqliteRepos = require('@arkade-os/sdk/repositories/sqlite')
    SQLiteWalletRepository = sqliteRepos.SQLiteWalletRepository
    SQLiteContractRepository = sqliteRepos.SQLiteContractRepository
    console.log('[protocols] Arkade SQLite repositories available')
  } catch (e) {
    console.warn('[protocols] Arkade SQLite repositories not available:', e)
  }

  arkadeClientManager.setSdkFactory({
    createWallet: async (config: any) => {
      console.log('[Arkade] Creating wallet with config:', {
        arkServerUrl: config.arkServerUrl,
        hasIdentity: !!config.identity,
        hasStorage: !!config.storage,
        hasSettlement: !!config.settlementConfig,
      })

      // Match extension pattern: pass identity + arkServerUrl + storage + settlement
      // Do NOT override arkProvider/indexerProvider — let SDK create its own internally
      const walletConfig: Record<string, any> = {
        identity: config.identity,
        arkServerUrl: config.arkServerUrl,
      }

      // Pass esploraUrl only if explicitly set (SDK defaults to mempool.space)
      if (config.esploraUrl) {
        walletConfig.esploraUrl = config.esploraUrl
      }

      // Settlement config
      if (config.settlementConfig) {
        walletConfig.settlementConfig = config.settlementConfig
      }

      // Storage: use SQLite repositories for React Native (replaces IndexedDB)
      if (SQLiteWalletRepository && SQLiteContractRepository) {
        try {
          const pubKeyBytes = await config.identity.xOnlyPublicKey()
          const pubKeyHex = Array.from(pubKeyBytes as Uint8Array)
            .map((b) => (b as number).toString(16).padStart(2, '0')).join('')
          const dbName = `arkade-wallet-signet-${pubKeyHex.slice(0, 16)}`

          // Open an expo-sqlite database and wrap with {run, get, all} for the SDK
          const SQLite = require('expo-sqlite')
          const expoDb = SQLite.openDatabaseSync(dbName)

          // SDK expects db.run(sql, params), db.get(sql, params), db.all(sql, params)
          // expo-sqlite v16 has runAsync/getFirstAsync/getAllAsync
          const dbAdapter = {
            run: (sql: string, params?: any[]) => expoDb.runAsync(sql, params || []),
            get: (sql: string, params?: any[]) => expoDb.getFirstAsync(sql, params || []),
            all: (sql: string, params?: any[]) => expoDb.getAllAsync(sql, params || []),
          }

          walletConfig.storage = {
            walletRepository: new SQLiteWalletRepository(dbAdapter),
            contractRepository: new SQLiteContractRepository(dbAdapter),
          }
          console.log('[Arkade] Using SQLite storage:', dbName)
        } catch (e) {
          console.warn('[Arkade] Failed to create SQLite storage:', e)
        }
      }

      console.log('[Arkade] Calling Wallet.create with:', JSON.stringify({
        arkServerUrl: walletConfig.arkServerUrl,
        esploraUrl: walletConfig.esploraUrl || '(SDK default)',
        hasIdentity: !!walletConfig.identity,
        hasSettlement: !!walletConfig.settlementConfig,
        hasStorage: !!walletConfig.storageAdapter,
      }))
      try {
        const wallet = await Wallet.create(walletConfig)
        console.log('[Arkade] Wallet.create succeeded')
        return wallet
      } catch (walletErr: any) {
        console.error('[Arkade] Wallet.create failed:', walletErr?.message || walletErr)
        console.error('[Arkade] Error stack:', walletErr?.stack?.slice(0, 300))
        throw walletErr
      }
    },
    createIdentity: (hex: string) => SingleKey.fromHex(hex),
  })
  console.log('[protocols] Arkade SDK factory configured')
} catch (err) {
  console.warn('[protocols] @arkade-os/sdk not available:', err)
}

// Singleton ProtocolManager
let _protocolManager: ProtocolManager | null = null

/**
 * Wallet engine selector. The WDK-backed adapters (./wdk.ts) are the DEFAULT.
 * Set EXPO_PUBLIC_WALLET_ENGINE=native to fall back to the legacy native adapters
 * (escape hatch for debugging / regressions).
 */
export const WALLET_ENGINE: 'native' | 'wdk' =
  process.env.EXPO_PUBLIC_WALLET_ENGINE === 'native' ? 'native' : 'wdk'

export function getProtocolManager(): ProtocolManager {
  if (WALLET_ENGINE === 'wdk') return getWdkProtocolManager()
  if (!_protocolManager) {
    _protocolManager = new ProtocolManager()
    _protocolManager.registerAdapter(new SparkAdapter())
    _protocolManager.registerAdapter(new ArkadeAdapter())
    _protocolManager.registerAdapter(new RgbAdapter())
  }
  return _protocolManager
}

export const protocolManager = getProtocolManager()

/**
 * Initialize protocols based on wallet network configurations.
 */
export async function initializeProtocols(
  mnemonic: string,
  networkConfigs: Array<{ type: string; enabled: boolean; config?: string }>,
): Promise<Map<ProtocolType, { success: boolean; error?: string }>> {
  if (WALLET_ENGINE === 'wdk') return initializeWdkProtocols(mnemonic, networkConfigs)
  const manager = getProtocolManager()
  const results = new Map<ProtocolType, { success: boolean; error?: string }>()

  for (const nc of networkConfigs) {
    if (!nc.enabled) continue

    const protocol = networkTypeToProtocol(nc.type as any)
    if (!protocol) continue

    // Skip if already connected
    const existing = manager.getAdapterIfAvailable(protocol)
    if (existing?.isConnected()) {
      results.set(protocol, { success: true })
      continue
    }

    try {
      const parsedConfig = nc.config ? JSON.parse(nc.config) : {}
      let protocolConfig: any

      switch (protocol) {
        case 'SPARK':
          protocolConfig = {
            protocol: 'SPARK',
            mnemonic,
            network: parsedConfig.network || 'mainnet',
          } as SparkConfig
          break

        case 'ARKADE':
          protocolConfig = {
            protocol: 'ARKADE',
            mnemonic,
            arkServerUrl: parsedConfig.arkServerUrl || 'https://signet.arkade.sh',
            esploraUrl: parsedConfig.esploraUrl,
            network: parsedConfig.network || 'signet',
          } as ArkadeConfig
          break

        case 'RGB': {
          // RGB / RLN is OPTIONAL. Only attempt a connection when a usable node
          // URL is configured. A remote network with no URL set would otherwise
          // throw "Node URL is required" inside the adapter and spam errors on
          // every startup. Skipping keeps Spark + Arkade working without RGB.
          const rgbNodeUrl =
            parsedConfig.type === 'remote'
              ? parsedConfig.url
              : parsedConfig.nodeUrl || 'http://127.0.0.1:3000'

          if (!rgbNodeUrl) {
            console.log('[initializeProtocols] RGB skipped: no node URL configured')
            results.set(protocol, { success: false, error: 'skipped: no node URL configured' })
            continue
          }

          protocolConfig = {
            protocol: 'RGB',
            nodeUrl: rgbNodeUrl,
            makerUrl: parsedConfig.makerUrl,
            apiKey: parsedConfig.apiKey,
            network: parsedConfig.network || 'regtest',
          } as RgbConfig
          break
        }

        default:
          continue
      }

      await manager.connect(protocol, protocolConfig)
      results.set(protocol, { success: true })
      console.log(`[initializeProtocols] ${protocol} connected`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[initializeProtocols] ${protocol} failed:`, msg)
      results.set(protocol, { success: false, error: msg })
    }
  }

  return results
}

// Re-export everything consumers need from shared lib
export type { ProtocolType, IProtocolAdapter, SparkConfig, ArkadeConfig, RgbConfig } from '@kaleidorg/wallet-protocols'
export {
  ProtocolManager,
  kaleidoClientManager,
  flashnetClientManager,
  sparkClientManager,
  arkadeClientManager,
} from '@kaleidorg/wallet-protocols'
