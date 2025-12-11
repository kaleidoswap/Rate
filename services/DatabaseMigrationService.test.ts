// services/DatabaseMigrationService.test.ts
import DatabaseMigrationService from './DatabaseMigrationService';
import { openDatabaseAsync } from 'expo-sqlite';

// Mock expo-sqlite
jest.mock('expo-sqlite');
const mockedOpenDatabase = openDatabaseAsync as jest.Mock;

describe('DatabaseMigrationService', () => {
  let migrationService: DatabaseMigrationService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execAsync: jest.fn(),
      runAsync: jest.fn(),
      getFirstAsync: jest.fn(),
      getAllAsync: jest.fn(),
      closeAsync: jest.fn(),
    };

    mockedOpenDatabase.mockResolvedValue(mockDb);
    migrationService = DatabaseMigrationService.getInstance();
    jest.clearAllMocks();
  });

  describe('getCurrentVersion', () => {
    it('should return current version from database', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 3 });

      const version = await migrationService.getCurrentVersion();

      expect(version).toBe(3);
      expect(mockDb.getFirstAsync).toHaveBeenCalledWith('PRAGMA user_version');
    });

    it('should return 0 for new database', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 0 });

      const version = await migrationService.getCurrentVersion();

      expect(version).toBe(0);
    });
  });

  describe('runMigrations', () => {
    it('should run all pending migrations', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 0 });
      mockDb.runAsync.mockResolvedValue(undefined);
      mockDb.execAsync.mockResolvedValue(undefined);

      const result = await migrationService.runMigrations();

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBeGreaterThan(0);
      expect(mockDb.execAsync).toHaveBeenCalled();
    });

    it('should skip already applied migrations', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 2 });
      mockDb.runAsync.mockResolvedValue(undefined);
      mockDb.execAsync.mockResolvedValue(undefined);

      const result = await migrationService.runMigrations();

      expect(result.success).toBe(true);
      // Should only run migrations after version 2
    });

    it('should not run migrations if already at latest version', async () => {
      const latestVersion = 10; // Assume this is the latest
      mockDb.getFirstAsync.mockResolvedValue({ user_version: latestVersion });

      const result = await migrationService.runMigrations();

      expect(result.success).toBe(true);
      expect(result.migrationsRun).toBe(0);
    });

    it('should handle migration errors', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 0 });
      mockDb.execAsync.mockRejectedValue(new Error('Migration failed'));

      const result = await migrationService.runMigrations();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should update version after successful migration', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 0 });
      mockDb.runAsync.mockResolvedValue(undefined);
      mockDb.execAsync.mockResolvedValue(undefined);

      await migrationService.runMigrations();

      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('PRAGMA user_version')
      );
    });
  });

  describe('addMigration', () => {
    it('should add custom migration', async () => {
      const customMigration = {
        version: 100,
        name: 'custom_migration',
        up: jest.fn().mockResolvedValue(undefined),
      };

      mockDb.getFirstAsync.mockResolvedValue({ user_version: 99 });
      mockDb.runAsync.mockResolvedValue(undefined);
      mockDb.execAsync.mockResolvedValue(undefined);

      migrationService.addMigration(customMigration);

      const result = await migrationService.runMigrations();

      expect(result.success).toBe(true);
      expect(customMigration.up).toHaveBeenCalled();
    });

    it('should maintain migration order', async () => {
      const migration1 = {
        version: 101,
        name: 'migration_1',
        up: jest.fn().mockResolvedValue(undefined),
      };
      const migration2 = {
        version: 102,
        name: 'migration_2',
        up: jest.fn().mockResolvedValue(undefined),
      };

      mockDb.getFirstAsync.mockResolvedValue({ user_version: 100 });
      mockDb.runAsync.mockResolvedValue(undefined);
      mockDb.execAsync.mockResolvedValue(undefined);

      migrationService.addMigration(migration2);
      migrationService.addMigration(migration1);

      await migrationService.runMigrations();

      // Should execute in order: migration1 then migration2
      const call1Order = migration1.up.mock.invocationCallOrder[0];
      const call2Order = migration2.up.mock.invocationCallOrder[0];
      
      expect(call1Order).toBeLessThan(call2Order);
    });
  });

  describe('getMigrationHistory', () => {
    it('should return list of applied migrations', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { version: 1, name: 'initial_schema', applied_at: Date.now() },
        { version: 2, name: 'add_transactions', applied_at: Date.now() },
      ]);

      const history = await migrationService.getMigrationHistory();

      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(1);
      expect(history[1].version).toBe(2);
    });

    it('should return empty array for new database', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      const history = await migrationService.getMigrationHistory();

      expect(history).toHaveLength(0);
    });
  });

  describe('rollback', () => {
    it('should rollback last migration', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 3 });
      mockDb.runAsync.mockResolvedValue(undefined);
      mockDb.execAsync.mockResolvedValue(undefined);

      const result = await migrationService.rollback();

      expect(result.success).toBe(true);
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('PRAGMA user_version = 2')
      );
    });

    it('should fail rollback at version 0', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 0 });

      const result = await migrationService.rollback();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No migrations to rollback');
    });

    it('should handle rollback errors', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ user_version: 3 });
      mockDb.execAsync.mockRejectedValue(new Error('Rollback failed'));

      const result = await migrationService.rollback();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('resetDatabase', () => {
    it('should reset database to version 0', async () => {
      mockDb.execAsync.mockResolvedValue(undefined);

      const result = await migrationService.resetDatabase();

      expect(result.success).toBe(true);
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('DROP TABLE')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('PRAGMA user_version = 0')
      );
    });

    it('should handle reset errors', async () => {
      mockDb.execAsync.mockRejectedValue(new Error('Reset failed'));

      const result = await migrationService.resetDatabase();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

