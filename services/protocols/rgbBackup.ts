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
 */
import { File, Paths } from 'expo-file-system';
import { rgbBackupPassword, rgbL1WalletKey, type RgbL1Network } from './rgbL1';
import { toFilesystemPath } from './bark';
import { createVssClient, uploadBackupFile, vssSigningKey } from './rgbVss';

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

/** Per seed and network, apart from the other wallets' VSS data under the same key. */
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
        const client = createVssClient(RGB_VSS_SERVER_URL, rgbBackupStoreId(ctx.mnemonic, ctx.network), vssSigningKey(ctx.mnemonic));
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
