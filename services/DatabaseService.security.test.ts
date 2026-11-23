import DatabaseService from './DatabaseService';
import { SecurityService } from './SecurityService';

jest.mock('./SecurityService', () => ({ SecurityService: { getInstance: jest.fn() } }));

describe('wallet seed persistence', () => {
  const legacyWallet = { id: 4, name: 'Test wallet', created_at: 0, is_active: true, encrypted_mnemonic: 'test-only-seed' };
  const secure = { getMnemonic: jest.fn(), storeMnemonic: jest.fn() };
  let db: any;
  let service: DatabaseService;
  beforeEach(() => {
    jest.clearAllMocks();
    (SecurityService.getInstance as jest.Mock).mockReturnValue(secure);
    secure.getMnemonic.mockResolvedValue(null);
    db = {
      getFirstAsync: jest.fn().mockResolvedValue(legacyWallet),
      getAllAsync: jest.fn().mockResolvedValue([]),
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 5 }),
      withTransactionAsync: jest.fn(async (operation: () => Promise<void>) => operation()),
    };
    service = DatabaseService.getInstance();
    (service as any).db = db;
  });
  it('keeps the legacy seed when secure storage fails', async () => {
    secure.storeMnemonic.mockResolvedValue(false);
    const wallet = await service.getActiveWallet();
    expect(wallet?.encrypted_mnemonic).toBe(legacyWallet.encrypted_mnemonic);
    expect(db.runAsync).not.toHaveBeenCalled();
  });
  it('scrubs the legacy database value only after securely saving it', async () => {
    secure.storeMnemonic.mockResolvedValue(true);
    await service.getActiveWallet();
    expect(db.runAsync).toHaveBeenCalledWith('UPDATE wallets SET encrypted_mnemonic = NULL WHERE id = ?', [4]);
  });
  it('retries scrubbing when an earlier migration already saved the seed', async () => {
    secure.storeMnemonic.mockResolvedValue(true);
    db.runAsync.mockRejectedValueOnce(new Error('SQLite update was interrupted'));
    await expect(service.getActiveWallet()).rejects.toThrow('SQLite update was interrupted');

    secure.getMnemonic.mockResolvedValue(legacyWallet.encrypted_mnemonic);
    await expect(service.getActiveWallet()).resolves.toMatchObject({ encrypted_mnemonic: legacyWallet.encrypted_mnemonic });
    expect(secure.storeMnemonic).toHaveBeenCalledTimes(1);
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    expect(db.runAsync).toHaveBeenLastCalledWith('UPDATE wallets SET encrypted_mnemonic = NULL WHERE id = ?', [4]);
  });
  it('keeps the legacy seed when secure storage returns a different value', async () => {
    secure.getMnemonic.mockResolvedValue('different-test-seed');
    await expect(service.getActiveWallet()).resolves.toMatchObject({ encrypted_mnemonic: 'different-test-seed' });
    expect(secure.storeMnemonic).not.toHaveBeenCalled();
    expect(db.runAsync).not.toHaveBeenCalled();
  });
  it('rejects creation inside a transaction when the seed cannot be saved', async () => {
    secure.storeMnemonic.mockResolvedValue(false);
    await expect(service.createWallet(legacyWallet, [])).rejects.toThrow('Could not securely save your wallet');
    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
  });
  it('creates a wallet when secure storage succeeds without inserting its seed into SQLite', async () => {
    secure.storeMnemonic.mockResolvedValue(true);
    await expect(service.createWallet(legacyWallet, [])).resolves.toBe(5);
    const insert = db.runAsync.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO wallets'));
    expect(insert[1]).not.toContain(legacyWallet.encrypted_mnemonic);
    expect(secure.storeMnemonic).toHaveBeenCalledWith(5, legacyWallet.encrypted_mnemonic);
  });
});
