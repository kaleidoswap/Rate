// services/DatabaseService.test.ts
import DatabaseService from './DatabaseService';

// DatabaseService imports SecurityService; the settings paths don't use it.
jest.mock('./SecurityService', () => ({ __esModule: true, default: { getInstance: jest.fn() }, SecurityService: { getInstance: jest.fn() } }));

const makeDb = () => ({
  runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 7, changes: 1 }),
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn().mockResolvedValue([]),
  execAsync: jest.fn(),
});

describe('DatabaseService', () => {
  const svc = DatabaseService.getInstance() as any;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = makeDb();
    svc.db = db;
    svc.encryptionKey = null;
  });

  describe('encrypted settings', () => {
    it('refuses to store an "encrypted" setting without a key', async () => {
      await expect(svc.setSetting('k', 'secret', true)).rejects.toThrow(/no encryption key/);
      expect(db.runAsync).not.toHaveBeenCalled();
    });

    it('refuses to return ciphertext as the value without a key', async () => {
      db.getFirstAsync.mockResolvedValue({ key: 'k', value: 'U2FsdGVk...', encrypted: 1 });
      await expect(svc.getSetting('k')).rejects.toThrow(/no encryption key/);
    });

    it('round-trips encrypted settings when a key is set', async () => {
      svc.encryptionKey = 'test-key';
      await svc.setSetting('k', 'secret', true);
      const stored = db.runAsync.mock.calls[0][1][1];
      expect(stored).not.toBe('secret');

      db.getFirstAsync.mockResolvedValue({ key: 'k', value: stored, encrypted: 1 });
      await expect(svc.getSetting('k')).resolves.toBe('secret');
    });
  });
});
