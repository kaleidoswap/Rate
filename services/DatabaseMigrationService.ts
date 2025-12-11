// services/DatabaseMigrationService.ts
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
  down?: (db: SQLite.SQLiteDatabase) => Promise<void>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: number;
}

export class DatabaseMigrationService {
  private static instance: DatabaseMigrationService;
  private db: SQLite.SQLiteDatabase | null = null;
  private migrations: Migration[] = [];
  private currentVersion: number = 0;

  private constructor() {
    this.registerMigrations();
  }

  public static getInstance(): DatabaseMigrationService {
    if (!DatabaseMigrationService.instance) {
      DatabaseMigrationService.instance = new DatabaseMigrationService();
    }
    return DatabaseMigrationService.instance;
  }

  /**
   * Initialize migration system
   */
  async initialize(db: SQLite.SQLiteDatabase): Promise<void> {
    this.db = db;
    await this.createMigrationsTable();
    this.currentVersion = await this.getCurrentVersion();
    console.log(`Current database version: ${this.currentVersion}`);
  }

  /**
   * Create migrations tracking table
   */
  private async createMigrationsTable(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Get current database version
   */
  private async getCurrentVersion(): Promise<number> {
    if (!this.db) return 0;

    try {
      const result = await this.db.getFirstAsync<{ version: number }>(
        'SELECT MAX(version) as version FROM migrations'
      );
      return result?.version || 0;
    } catch (error) {
      console.error('Error getting current version:', error);
      return 0;
    }
  }

  /**
   * Register all migrations
   */
  private registerMigrations(): void {
    // Migration 1: Add transaction metadata
    this.migrations.push({
      version: 1,
      name: 'add_transaction_metadata',
      up: async (db) => {
        await db.execAsync(`
          ALTER TABLE transactions ADD COLUMN metadata TEXT;
        `);
        console.log('Migration 1: Added metadata column to transactions');
      },
      down: async (db) => {
        // SQLite doesn't support DROP COLUMN, would need to recreate table
        console.log('Migration 1: Rollback not supported for ALTER TABLE ADD COLUMN');
      },
    });

    // Migration 2: Add wallet backup timestamp
    this.migrations.push({
      version: 2,
      name: 'add_wallet_backup_timestamp',
      up: async (db) => {
        await db.execAsync(`
          ALTER TABLE wallets ADD COLUMN last_backup INTEGER;
        `);
        console.log('Migration 2: Added last_backup column to wallets');
      },
    });

    // Migration 3: Add transaction retry count
    this.migrations.push({
      version: 3,
      name: 'add_transaction_retry_count',
      up: async (db) => {
        await db.execAsync(`
          ALTER TABLE transactions ADD COLUMN retry_count INTEGER DEFAULT 0;
        `);
        console.log('Migration 3: Added retry_count column to transactions');
      },
    });

    // Migration 4: Add asset metadata
    this.migrations.push({
      version: 4,
      name: 'add_asset_metadata',
      up: async (db) => {
        await db.execAsync(`
          ALTER TABLE rgb_assets ADD COLUMN metadata TEXT;
          ALTER TABLE rgb_assets ADD COLUMN icon_url TEXT;
        `);
        console.log('Migration 4: Added metadata and icon_url columns to rgb_assets');
      },
    });

    // Migration 5: Add settings category
    this.migrations.push({
      version: 5,
      name: 'add_settings_category',
      up: async (db) => {
        await db.execAsync(`
          ALTER TABLE app_settings ADD COLUMN category TEXT DEFAULT 'general';
        `);
        console.log('Migration 5: Added category column to app_settings');
      },
    });

    // Migration 6: Add wallet notes
    this.migrations.push({
      version: 6,
      name: 'add_wallet_notes',
      up: async (db) => {
        await db.execAsync(`
          ALTER TABLE wallets ADD COLUMN notes TEXT;
        `);
        console.log('Migration 6: Added notes column to wallets');
      },
    });

    // Migration 7: Add transaction labels
    this.migrations.push({
      version: 7,
      name: 'add_transaction_labels',
      up: async (db) => {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS transaction_labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_transaction_labels_tx_id ON transaction_labels(transaction_id);
        `);
        console.log('Migration 7: Created transaction_labels table');
      },
    });

    // Migration 8: Add contact favorites
    this.migrations.push({
      version: 8,
      name: 'add_contact_favorites',
      up: async (db) => {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS favorite_contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('lightning', 'bitcoin', 'rgb')),
            added_at INTEGER NOT NULL,
            FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_favorite_contacts_wallet_id ON favorite_contacts(wallet_id);
        `);
        console.log('Migration 8: Created favorite_contacts table');
      },
    });
  }

  /**
   * Run pending migrations
   */
  async migrate(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const pendingMigrations = this.migrations.filter(
      m => m.version > this.currentVersion
    );

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations');
      return;
    }

    console.log(`Running ${pendingMigrations.length} pending migrations...`);

    for (const migration of pendingMigrations) {
      try {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);
        
        // Run migration
        await migration.up(this.db);
        
        // Record migration
        await this.db.runAsync(
          'INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, Date.now()]
        );
        
        this.currentVersion = migration.version;
        console.log(`Migration ${migration.version} applied successfully`);
      } catch (error) {
        console.error(`Migration ${migration.version} failed:`, error);
        throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error}`);
      }
    }

    console.log('All migrations completed successfully');
  }

  /**
   * Rollback last migration
   */
  async rollback(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (this.currentVersion === 0) {
      console.log('No migrations to rollback');
      return;
    }

    const migration = this.migrations.find(m => m.version === this.currentVersion);
    
    if (!migration) {
      throw new Error(`Migration ${this.currentVersion} not found`);
    }

    if (!migration.down) {
      throw new Error(`Migration ${this.currentVersion} does not support rollback`);
    }

    try {
      console.log(`Rolling back migration ${migration.version}: ${migration.name}`);
      
      // Run rollback
      await migration.down(this.db);
      
      // Remove migration record
      await this.db.runAsync(
        'DELETE FROM migrations WHERE version = ?',
        [migration.version]
      );
      
      this.currentVersion = await this.getCurrentVersion();
      console.log(`Migration ${migration.version} rolled back successfully`);
    } catch (error) {
      console.error(`Rollback of migration ${migration.version} failed:`, error);
      throw error;
    }
  }

  /**
   * Get migration history
   */
  async getHistory(): Promise<MigrationRecord[]> {
    if (!this.db) return [];

    try {
      const results = await this.db.getAllAsync<MigrationRecord>(
        'SELECT * FROM migrations ORDER BY version ASC'
      );
      return results;
    } catch (error) {
      console.error('Error getting migration history:', error);
      return [];
    }
  }

  /**
   * Get pending migrations
   */
  getPendingMigrations(): Migration[] {
    return this.migrations.filter(m => m.version > this.currentVersion);
  }

  /**
   * Get latest migration version
   */
  getLatestVersion(): number {
    return this.migrations.length > 0
      ? Math.max(...this.migrations.map(m => m.version))
      : 0;
  }

  /**
   * Check if migrations are needed
   */
  needsMigration(): boolean {
    return this.currentVersion < this.getLatestVersion();
  }

  /**
   * Reset database (DANGEROUS - for development only)
   */
  async reset(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    console.warn('RESETTING DATABASE - ALL DATA WILL BE LOST');
    
    // Drop all tables
    await this.db.execAsync(`
      DROP TABLE IF EXISTS migrations;
      DROP TABLE IF EXISTS transactions;
      DROP TABLE IF EXISTS rgb_assets;
      DROP TABLE IF EXISTS wallet_networks;
      DROP TABLE IF EXISTS wallets;
      DROP TABLE IF EXISTS app_settings;
      DROP TABLE IF EXISTS transaction_labels;
      DROP TABLE IF EXISTS favorite_contacts;
    `);
    
    this.currentVersion = 0;
    console.log('Database reset complete');
  }

  /**
   * Export migration status
   */
  async getStatus(): Promise<{
    currentVersion: number;
    latestVersion: number;
    needsMigration: boolean;
    pendingCount: number;
    history: MigrationRecord[];
  }> {
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.getLatestVersion(),
      needsMigration: this.needsMigration(),
      pendingCount: this.getPendingMigrations().length,
      history: await this.getHistory(),
    };
  }
}

export default DatabaseMigrationService;

