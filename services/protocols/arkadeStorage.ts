/**
 * Arkade persistent storage (SQLite) — KaleidoSwap App
 * ----------------------------------------------------
 * The @arkade-os/wdk `ArkadeWalletConfig.storage` slot accepts
 * `{ walletRepository, contractRepository }`. If omitted, the module defaults to
 * IN-MEMORY repositories, so VTXO state is lost on every app restart.
 *
 * This builds the SQLite-backed repositories from `@arkade-os/sdk/repositories/sqlite`
 * wrapped around an `expo-sqlite` database, mirroring the pre-WDK native adapter.
 *
 * Everything is loaded lazily and guarded: if either dependency is unavailable, or
 * construction throws, we return `undefined` so the caller falls back to in-memory.
 *
 * The db name is keyed by network + account index because the wallet identity/pubkey
 * isn't available before the manager creates the wallet.
 */

/**
 * Build the SQLite storage repositories for the Arkade WDK wallet.
 * Returns `undefined` (never throws) when SQLite storage can't be constructed,
 * so the caller leaves `storage` unset and Arkade stays in-memory.
 */
export function buildArkadeStorage(opts: {
  network: string
  accountIndex?: number
}): { walletRepository: any; contractRepository: any } | undefined {
  try {
    let SQLiteWalletRepository: any
    let SQLiteContractRepository: any
    try {
      const sqliteRepos = require('@arkade-os/sdk/repositories/sqlite')
      SQLiteWalletRepository = sqliteRepos.SQLiteWalletRepository
      SQLiteContractRepository = sqliteRepos.SQLiteContractRepository
    } catch (e) {
      console.warn('[arkadeStorage] SQLite repositories not available:', e)
      return undefined
    }
    if (!SQLiteWalletRepository || !SQLiteContractRepository) return undefined

    let SQLite: any
    try {
      SQLite = require('expo-sqlite')
    } catch (e) {
      console.warn('[arkadeStorage] expo-sqlite not available:', e)
      return undefined
    }

    const dbName = `arkade-wallet-${opts.network}-${opts.accountIndex ?? 0}`
    const db = SQLite.openDatabaseSync(dbName)

    // The SDK expects db.run(sql, params), db.get(sql, params), db.all(sql, params).
    // Arkade's contract watcher and boarding-UTXO pollers can hit this storage
    // concurrently and outlive foreground UI calls. On Android, expo-sqlite's
    // async prepared-statement path has produced NativeDatabase.prepareAsync NPEs
    // in those background polls. Keep the SDK's async-shaped executor, but run
    // the small repository queries through the sync helpers to avoid that native
    // async statement lifecycle.
    const dbAdapter = {
      run: async (sql: string, params?: any[]) => db.runSync(sql, params || []),
      get: async (sql: string, params?: any[]) => db.getFirstSync(sql, params || []),
      all: async (sql: string, params?: any[]) => db.getAllSync(sql, params || []),
    }

    return {
      walletRepository: new SQLiteWalletRepository(dbAdapter),
      contractRepository: new SQLiteContractRepository(dbAdapter),
    }
  } catch (e) {
    console.warn('[arkadeStorage] Failed to build SQLite storage:', e)
    return undefined
  }
}
