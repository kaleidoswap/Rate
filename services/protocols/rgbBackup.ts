/**
 * Automatic cloud backup for RGB on this phone
 * -------------------------------------------
 * RGB assets can't be rebuilt from the seed alone: rgb-lib's wallet holds the
 * consignments. After every change (send, receive, settled transfer, new UTXOs)
 * the RGB_L1 bridge calls `scheduleRgbBackup()`; a few seconds later, if rgb-lib
 * says the wallet changed since its last backup, this writes rgb-lib's encrypted
 * backup file and uploads it to the KaleidoSwap VSS server (./rgbVss.ts).
 *
 * Best-effort and never throws into the caller: a failure is kept for Settings
 * to show and retried on the next change.
 *
 * `restoreRgbFromCloud()` is the way back: on a phone without this wallet's RGB
 * data it downloads the last upload and hands it to rgb-lib before the wallet
 * first opens.
 */
import { File, Paths } from 'expo-file-system';
import { rgbBackupPassword, rgbL1DataId, rgbL1WalletKey, type RgbL1Network } from './rgbL1';
import { toFilesystemPath } from './bark';
import { createVssClient, downloadBackupFile, readBackupManifest, uploadBackupFile, vssSigningKey, type BackupManifest } from './rgbVss';

export const RGB_VSS_SERVER_URL = process.env.EXPO_PUBLIC_VSS_SERVER_URL || 'https://vss.kaleidoswap.com/vss';
const DEBOUNCE_MS = 4000;
const PREFIX = 'rgb-backup-file';

export interface RgbBackupStatus {
  state: 'idle' | 'backing-up' | 'done' | 'failed';
  lastBackupAt?: number;
  error?: string;
}

interface BackupContext {
  mnemonic: string
  network: RgbL1Network
  /** The connected rgb-lib account (./rgbLibRn.ts), or null once disconnected. */
  account: () => any
}
let context: BackupContext | null = null;
let status: RgbBackupStatus = { state: 'idle' };
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
const listeners = new Set<(s: RgbBackupStatus) => void>();

const setStatus = (next: RgbBackupStatus) => { status = next; listeners.forEach((l) => l(status)); };

export const rgbBackupStatus = () => status;
export function onRgbBackupStatus(listener: (s: RgbBackupStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Per seed and wallet (`rgbL1DataId`), apart from the other wallets' VSS data under the same key. */
export const rgbBackupStoreId = (mnemonic: string, network: string) => `rgb-l1-file-${rgbL1WalletKey(mnemonic)}-${network}`;

/** Set while RGB on this phone is connected (./wdk.ts), cleared when it disconnects. */
export function setRgbBackupContext(next: BackupContext | null): void {
  context = next;
  if (!next && timer) { clearTimeout(timer); timer = null; }
}

/** Debounced: a send touches several allocations, then a refresh settles them — one upload. */
export function scheduleRgbBackup(): void {
  if (!context) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void runRgbBackup(); }, DEBOUNCE_MS);
}

/** Back up now if the wallet changed since the last backup (or always with `force`). */
export async function runRgbBackup(force = false): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      const ctx = context;
      const account = ctx?.account();
      if (!ctx || !account) return;
      if (!force && !(await account.backupRequired())) return;
      setStatus({ ...status, state: 'backing-up', error: undefined });
      const file = new File(Paths.cache, `rgb-backup-${Date.now()}.rgbbackup`);
      try {
        await account.backup(toFilesystemPath(file.uri), rgbBackupPassword(ctx.mnemonic));
        const data = await file.bytes();
        const client = createVssClient(RGB_VSS_SERVER_URL, rgbBackupStoreId(ctx.mnemonic, rgbL1DataId(ctx.network)), vssSigningKey(ctx.mnemonic));
        const manifest = await uploadBackupFile(client, PREFIX, data);
        setStatus({ state: 'done', lastBackupAt: manifest.createdAt });
      } finally {
        try { if (file.exists) file.delete(); } catch { /* cache is cleared by the OS anyway */ }
      }
    } catch (e: any) {
      console.warn('[RGB backup] failed (will retry on the next change):', e?.message ?? e);
      setStatus({ ...status, state: 'failed', error: e?.message ?? 'Backup failed' });
    } finally {
      running = null;
      if (again) { again = false; scheduleRgbBackup(); }
    }
  })();
  return running;
}

const storeClient = (mnemonic: string, network: RgbL1Network) =>
  createVssClient(RGB_VSS_SERVER_URL, rgbBackupStoreId(mnemonic, rgbL1DataId(network)), vssSigningKey(mnemonic));

/**
 * Whether this seed has a cloud backup on `network`, without downloading it.
 * Throws when the server can't be reached: "can't tell" is never "no backup".
 */
export async function findRgbCloudBackup(mnemonic: string, network: RgbL1Network): Promise<BackupManifest | null> {
  return (await readBackupManifest(storeClient(mnemonic, network), PREFIX)) ?? null;
}

export type RgbRestoreResult = 'restored' | 'no-backup' | 'already-on-phone';

/**
 * Restores this seed's RGB data from the cloud backup, when there is one and
 * the phone doesn't hold the wallet yet (rgb-lib refuses to restore over it).
 * Throws when the backup can't be checked or read: the caller must not start
 * a fresh wallet then, or its first backup would replace the real one.
 */
export async function restoreRgbFromCloud(opts: {
  mnemonic: string
  network: RgbL1Network
  /** rgb-lib's `restoreBackup(path, password)`. */
  restore: (path: string, password: string) => Promise<void>
}): Promise<RgbRestoreResult> {
  const backup = await downloadBackupFile(storeClient(opts.mnemonic, opts.network), PREFIX);
  if (!backup) return 'no-backup';
  const file = new File(Paths.cache, `rgb-restore-${Date.now()}.rgbbackup`);
  try {
    file.write(backup.data);
    await opts.restore(toFilesystemPath(file.uri), rgbBackupPassword(opts.mnemonic));
  } catch (e: any) {
    if (/WalletDirAlreadyExists|WALLET_DIR_ALREADY_EXISTS|already exists/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`)) return 'already-on-phone';
    throw e;
  } finally {
    try { if (file.exists) file.delete(); } catch { /* cache is cleared by the OS anyway */ }
  }
  setStatus({ state: 'done', lastBackupAt: backup.manifest.createdAt });
  return 'restored';
}

/**
 * Restores this seed's RGB data from a backup file the user picked (an export
 * from "Export backup file"). Same rules as the cloud restore: rgb-lib refuses
 * to overwrite a wallet already on the phone, and the password is the seed's.
 */
export async function restoreRgbFromFile(opts: {
  mnemonic: string
  path: string
  restore: (path: string, password: string) => Promise<void>
}): Promise<void> {
  try {
    await opts.restore(opts.path, rgbBackupPassword(opts.mnemonic));
  } catch (e: any) {
    const why = `${e?.code ?? ''} ${e?.message ?? ''}`;
    if (/WalletDirAlreadyExists|WALLET_DIR_ALREADY_EXISTS|already exists/i.test(why)) {
      throw new Error('This phone already has RGB data for this wallet, so the file wasn’t restored.');
    }
    if (/password|decrypt|InvalidBackup|WrongPassword|WRONG_PASSWORD|UnsupportedBackupVersion/i.test(why)) {
      throw new Error('This backup file isn’t for this wallet, or it’s damaged.');
    }
    throw e;
  }
}
