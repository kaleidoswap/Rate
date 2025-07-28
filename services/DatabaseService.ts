// services/DatabaseService.ts
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';

export interface WalletRecord {
  id?: number;
  name: string;
  network: 'mainnet' | 'testnet' | 'regtest' | 'signet';
  derivation_path?: string;
  created_at: number;
  is_active: boolean;
  node_pubkey?: string;
  encrypted_mnemonic?: string;
}

export interface AssetRecord {
  id?: number;
  wallet_id: number;
  asset_id: string;
  ticker: string;
  name: string;
  precision: number;
  issued_supply: number;
  balance: number;
  last_updated: number;
}

export interface TransactionRecord {
  id?: number;
  wallet_id: number;
  txid: string;
  type: 'send' | 'receive' | 'issue';
  amount: number;
  asset_id?: string;
  address: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  block_height?: number;
  fee?: number;
}

export interface AppSettings {
  id?: number;
  key: string;
  value: string;
  encrypted: boolean;
}

export class DatabaseService {
  private static instance: DatabaseService;
  private db: SQLite.SQLiteDatabase | null = null;
  private encryptionKey: string | null = null;

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private constructor() {}

  /**
   * Initialize the database with encryption
   */
  async initializeDatabase(userPin?: string): Promise<void> {
    try {
      // Generate or retrieve encryption key
      if (userPin) {
        this.encryptionKey = await this.deriveEncryptionKey(userPin);
      }

      // Open database
      this.db = await SQLite.openDatabaseAsync('rate_wallet.db');

      // Enable WAL mode for better performance
      await this.db.execAsync('PRAGMA journal_mode = WAL');
      await this.db.execAsync('PRAGMA foreign_keys = ON');

      // Create tables
      await this.createTables();

      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const queries = [
      // Wallets table
      `CREATE TABLE IF NOT EXISTS wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        network TEXT NOT NULL CHECK(network IN ('mainnet', 'testnet', 'regtest', 'signet')),
        derivation_path TEXT,
        created_at INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT FALSE,
        node_pubkey TEXT,
        encrypted_mnemonic TEXT
      )`,

      // RGB Assets table
      `CREATE TABLE IF NOT EXISTS rgb_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_id INTEGER NOT NULL,
        asset_id TEXT NOT NULL UNIQUE,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL,
        precision INTEGER NOT NULL DEFAULT 0,
        issued_supply INTEGER NOT NULL DEFAULT 0,
        balance REAL DEFAULT 0,
        last_updated INTEGER NOT NULL,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
      )`,

      // Transactions table
      `CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_id INTEGER NOT NULL,
        txid TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('send', 'receive', 'issue')),
        amount REAL NOT NULL,
        asset_id TEXT,
        address TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'failed')),
        timestamp INTEGER NOT NULL,
        block_height INTEGER,
        fee REAL,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
      )`,

      // App settings table
      `CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        encrypted BOOLEAN DEFAULT FALSE
      )`,

      // Create indexes for better performance
      `CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_assets_wallet_id ON rgb_assets(wallet_id)`,
      `CREATE INDEX IF NOT EXISTS idx_assets_asset_id ON rgb_assets(asset_id)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_settings_key ON app_settings(key)`
    ];

    for (const query of queries) {
      await this.db.execAsync(query);
    }
  }

  // Wallet operations
  async createWallet(wallet: Omit<WalletRecord, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    // Deactivate other wallets if this one is active
    if (wallet.is_active) {
      await this.db.runAsync('UPDATE wallets SET is_active = FALSE');
    }

    const result = await this.db.runAsync(
      `INSERT INTO wallets (name, network, derivation_path, created_at, is_active, node_pubkey, encrypted_mnemonic)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        wallet.name,
        wallet.network,
        wallet.derivation_path || null,
        wallet.created_at,
        wallet.is_active ? 1 : 0,
        wallet.node_pubkey || null,
        wallet.encrypted_mnemonic || null
      ]
    );

    return result.lastInsertRowId;
  }

  async getActiveWallet(): Promise<WalletRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getFirstAsync<WalletRecord>(
      'SELECT * FROM wallets WHERE is_active = TRUE'
    );

    return result || null;
  }

  async getAllWallets(): Promise<WalletRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const results = await this.db.getAllAsync<WalletRecord>(
      'SELECT * FROM wallets ORDER BY created_at DESC'
    );

    return results;
  }

  async setActiveWallet(walletId: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('BEGIN TRANSACTION');
    try {
      await this.db.runAsync('UPDATE wallets SET is_active = FALSE');
      await this.db.runAsync('UPDATE wallets SET is_active = TRUE WHERE id = ?', [walletId]);
      await this.db.runAsync('COMMIT');
    } catch (error) {
      await this.db.runAsync('ROLLBACK');
      throw error;
    }
  }

  // RGB Asset operations
  async upsertAsset(asset: Omit<AssetRecord, 'id'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      `INSERT OR REPLACE INTO rgb_assets 
       (wallet_id, asset_id, ticker, name, precision, issued_supply, balance, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset.wallet_id,
        asset.asset_id,
        asset.ticker,
        asset.name,
        asset.precision,
        asset.issued_supply,
        asset.balance,
        asset.last_updated
      ]
    );
  }

  async getAssetsByWallet(walletId: number): Promise<AssetRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const results = await this.db.getAllAsync<AssetRecord>(
      'SELECT * FROM rgb_assets WHERE wallet_id = ? ORDER BY name',
      [walletId]
    );

    return results;
  }

  async updateAssetBalance(assetId: string, balance: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE rgb_assets SET balance = ?, last_updated = ? WHERE asset_id = ?',
      [balance, Date.now(), assetId]
    );
  }

  // Transaction operations
  async addTransaction(transaction: Omit<TransactionRecord, 'id'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.runAsync(
      `INSERT INTO transactions 
       (wallet_id, txid, type, amount, asset_id, address, status, timestamp, block_height, fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transaction.wallet_id,
        transaction.txid,
        transaction.type,
        transaction.amount,
        transaction.asset_id || null,
        transaction.address,
        transaction.status,
        transaction.timestamp,
        transaction.block_height || null,
        transaction.fee || null
      ]
    );

    return result.lastInsertRowId;
  }

  async getTransactionsByWallet(walletId: number, limit: number = 50): Promise<TransactionRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const results = await this.db.getAllAsync<TransactionRecord>(
      'SELECT * FROM transactions WHERE wallet_id = ? ORDER BY timestamp DESC LIMIT ?',
      [walletId, limit]
    );

    return results;
  }

  async updateTransactionStatus(txid: string, status: 'pending' | 'confirmed' | 'failed', blockHeight?: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync(
      'UPDATE transactions SET status = ?, block_height = ? WHERE txid = ?',
      [status, blockHeight || null, txid]
    );
  }

  // Settings operations
  async setSetting(key: string, value: string, encrypted: boolean = false): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    let finalValue = value;
    if (encrypted && this.encryptionKey) {
      finalValue = this.encrypt(value);
    }

    await this.db.runAsync(
      'INSERT OR REPLACE INTO app_settings (key, value, encrypted) VALUES (?, ?, ?)',
      [key, finalValue, encrypted ? 1 : 0]
    );
  }

  async getSetting(key: string): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getFirstAsync<AppSettings>(
      'SELECT * FROM app_settings WHERE key = ?',
      [key]
    );

    if (!result) return null;

    if (result.encrypted && this.encryptionKey) {
      return this.decrypt(result.value);
    }

    return result.value;
  }

  // Encryption utilities
  private async deriveEncryptionKey(pin: string): Promise<string> {
    // Get or create salt
    let salt = await SecureStore.getItemAsync('db_salt');
    if (!salt) {
      salt = CryptoJS.lib.WordArray.random(16).toString();
      await SecureStore.setItemAsync('db_salt', salt);
    }

    // Derive key using PBKDF2
    const key = CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: 10000
    });

    return key.toString();
  }

  private encrypt(text: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not set');
    
    const encrypted = CryptoJS.AES.encrypt(text, this.encryptionKey);
    return encrypted.toString();
  }

  private decrypt(encryptedText: string): string {
    if (!this.encryptionKey) throw new Error('Encryption key not set');
    
    const decrypted = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
    return decrypted.toString(CryptoJS.enc.Utf8);
  }

  // Cleanup
  async closeDatabase(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
    }
  }
}

export default DatabaseService;