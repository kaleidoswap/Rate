// services/DatabaseService.test.ts
import DatabaseService from './DatabaseService';
import SecurityService from './SecurityService';

jest.mock('./SecurityService', () => {
  const instance = { storeMnemonic: jest.fn(), getMnemonic: jest.fn() };
  return { __esModule: true, default: { getInstance: () => instance }, SecurityService: { getInstance: () => instance } };
});

const security = SecurityService.getInstance() as unknown as { storeMnemonic: jest.Mock };

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

  describe('createWallet', () => {
    const wallet = { name: 'Main', created_at: 1, is_active: true, encrypted_mnemonic: 'abandon abandon' } as any;

    it('rolls back and throws when the seed cannot be stored securely', async () => {
      db.getFirstAsync.mockResolvedValue({ id: 3 }); // previously active wallet
      security.storeMnemonic.mockResolvedValue(false);

      await expect(svc.createWallet(wallet, [])).rejects.toThrow(/recovery phrase/);

      const sql = db.runAsync.mock.calls.map((c: any[]) => c[0]);
      expect(sql).toContain('DELETE FROM wallets WHERE id = ?');
      expect(db.runAsync).toHaveBeenCalledWith('UPDATE wallets SET is_active = TRUE WHERE id = ?', [3]);
    });

    it('returns the new id when the seed is stored', async () => {
      db.getFirstAsync.mockResolvedValue(null);
      security.storeMnemonic.mockResolvedValue(true);

      await expect(svc.createWallet(wallet, [])).resolves.toBe(7);
      expect(security.storeMnemonic).toHaveBeenCalledWith(7, 'abandon abandon');
    });
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
