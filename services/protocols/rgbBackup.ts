import AsyncStorage from '@react-native-async-storage/async-storage';
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
import {
  createVssClient, downloadBackupFile, readBackupManifest, readVersionedBackupManifest,
  RGB_BACKUP_CONFLICT, uploadBackupFile, vssSigningKey, type BackupManifest,
} from './rgbVss';
import { describeRgbError, recordRgbDiagnostic } from './rgbDiagnostics';

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
let contextRevision = 0;
let status: RgbBackupStatus = { state: 'idle' };
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
let localBackupQueue: Promise<unknown> = Promise.resolve();
const listeners = new Set<(s: RgbBackupStatus) => void>();

const setStatus = (next: RgbBackupStatus) => { status = next; listeners.forEach((l) => l(status)); };

export const rgbBackupStatus = () => status;
export function onRgbBackupStatus(listener: (s: RgbBackupStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Per seed and wallet (`rgbL1DataId`), apart from the other wallets' VSS data under the same key. */
export const rgbBackupStoreId = (mnemonic: string, network: string) => `rgb-l1-file-${rgbL1WalletKey(mnemonic)}-${network}`;

type BackupWallet = Pick<BackupContext, 'mnemonic' | 'network'>;
type BackupLineage = Pick<BackupManifest, 'createdAt' | 'sha256'>;

const storeId = (ctx: BackupWallet) => rgbBackupStoreId(ctx.mnemonic, rgbL1DataId(ctx.network));
const lastBackupKey = (ctx: BackupWallet) => `rgb-last-backup-${storeId(ctx)}`;
const retryKey = (ctx: BackupWallet) => `rgb-backup-pending-${storeId(ctx)}`;

async function localBackup(ctx: BackupWallet): Promise<Partial<BackupLineage>> {
  const raw = await AsyncStorage.getItem(lastBackupKey(ctx));
  if (!raw || raw === 'empty') return {};
  const legacyTimestamp = Number(raw);
  if (Number.isFinite(legacyTimestamp) && legacyTimestamp > 0) return { createdAt: legacyTimestamp };
  try {
    const value = JSON.parse(raw) as Partial<BackupLineage>;
    if (typeof value?.sha256 === 'string' && Number.isFinite(value.createdAt)) return value;
  } catch { /* there is no known cloud lineage */ }
  return {};
}

function rememberBackup(ctx: BackupWallet, manifest: BackupManifest): Promise<void> {
  return AsyncStorage.setItem(lastBackupKey(ctx), JSON.stringify({ sha256: manifest.sha256, createdAt: manifest.createdAt }));
}

function queueLocalBackup<T>(task: () => Promise<T>): Promise<T> {
  const run = localBackupQueue.then(task);
  localBackupQueue = run.catch(() => undefined);
  return run;
}

/** A local wallet not restored from the cloud cannot replace a remote backup. */
export function resetRgbBackupLineage(mnemonic: string, network: RgbL1Network): Promise<void> {
  return queueLocalBackup(async () => {
    const ctx = { mnemonic, network };
    await AsyncStorage.setItem(lastBackupKey(ctx), 'empty');
    await AsyncStorage.removeItem(retryKey(ctx));
  });
}

/** Exporting a file also clears rgb-lib's dirty bit. Keep cloud backup owed until it publishes. */
export async function exportRgbBackupFile(
  mnemonic: string,
  network: RgbL1Network,
  account: { backup(path: string, password: string): Promise<void> },
  path: string,
): Promise<void> {
  const ctx = { mnemonic, network };
  try {
    await queueLocalBackup(async () => {
      const key = retryKey(ctx);
      if (!(await AsyncStorage.getItem(key))) await AsyncStorage.setItem(key, '1');
      await account.backup(path, rgbBackupPassword(mnemonic));
    });
  } finally {
    if (context?.mnemonic === mnemonic && context.network === network) scheduleRgbBackup();
  }
}

/** Set while RGB on this phone is connected (./wdk.ts), cleared when it disconnects. */
export function setRgbBackupContext(next: BackupContext | null): void {
  const changed = context?.mnemonic !== next?.mnemonic || context?.network !== next?.network;
  context = next;
  if (changed) {
    const revision = ++contextRevision;
    setStatus({ state: 'idle' });
    if (next) void localBackup(next).then(({ createdAt }) => {
      if (revision === contextRevision && !status.lastBackupAt && createdAt) {
        setStatus({ ...status, lastBackupAt: createdAt });
      }
    }).catch(() => undefined);
  }
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
  const ctx = context;
  const revision = contextRevision;
  const account = ctx?.account();
  running = queueLocalBackup(async () => {
    const update = (next: RgbBackupStatus) => {
      if (contextRevision === revision) setStatus(next);
    };
    try {
      if (!ctx || !account || contextRevision !== revision) return;
      const retry = retryKey(ctx);
      const pending = await AsyncStorage.getItem(retry);
      if (!force && !pending && !(await account.backupRequired())) return;

      const client = storeClient(ctx.mnemonic, ctx.network);
      const previous = await readVersionedBackupManifest(client, PREFIX);
      const known = await localBackup(ctx);
      const remote = previous?.manifest;
      if (remote && remote.sha256 !== known.sha256) {
        const acknowledged = remote.sha256 === pending;
        const legacyMatch = previous?.legacy && !known.sha256 && known.createdAt === remote.createdAt;
        if (!acknowledged && !legacyMatch) throw new Error(RGB_BACKUP_CONFLICT);
        // Adopt a legacy success once, or finish an upload whose reply was interrupted.
        await rememberBackup(ctx, remote);
        if (acknowledged && !force && !(await account.backupRequired())) {
          await AsyncStorage.removeItem(retry);
          update({ state: 'done', lastBackupAt: remote.createdAt });
          return;
        }
      }

      if (contextRevision !== revision) return;
      // rgb-lib clears its dirty flag before the upload succeeds. Persist the retry first.
      await AsyncStorage.setItem(retry, '1');
      update({ ...status, state: 'backing-up', error: undefined });
      const file = new File(Paths.cache, `rgb-backup-${Date.now()}.rgbbackup`);
      try {
        await account.backup(toFilesystemPath(file.uri), rgbBackupPassword(ctx.mnemonic));
        const data = await file.bytes();
        const manifest = await uploadBackupFile(client, PREFIX, data, Date.now(), {
          previous,
          recordCandidate: (candidate) => AsyncStorage.setItem(retry, candidate.sha256),
        });
        await rememberBackup(ctx, manifest);
        await AsyncStorage.removeItem(retry);
        update({ state: 'done', lastBackupAt: manifest.createdAt });
      } finally {
        try { if (file.exists) file.delete(); } catch { /* cache is cleared by the OS anyway */ }
      }
    } catch (e: any) {
      recordRgbDiagnostic('backup_failed', `${context?.network ?? ''}: ${describeRgbError(e)}`);
      update({ ...status, state: 'failed', error: e?.message ?? 'Backup failed' });
    } finally {
      running = null;
      if (again) { again = false; scheduleRgbBackup(); }
    }
  });
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
  await rememberBackup(opts, backup.manifest).catch(() => undefined);
  if (context?.mnemonic === opts.mnemonic && context.network === opts.network) {
    setStatus({ state: 'done', lastBackupAt: backup.manifest.createdAt });
  }
  return 'restored';
}

/**
 * Restores this seed's RGB data from a backup file the user picked (an export
 * from "Export backup file"). Same rules as the cloud restore: rgb-lib refuses
 * to overwrite a wallet already on the phone, and the password is the seed's.
 */
export async function restoreRgbFromFile(opts: {
  mnemonic: string
  network: RgbL1Network
  path: string
  restore: (path: string, password: string) => Promise<void>
}): Promise<void> {
  try {
    await opts.restore(opts.path, rgbBackupPassword(opts.mnemonic));
    await resetRgbBackupLineage(opts.mnemonic, opts.network);
  } catch (e: any) {
    const why = `${e?.code ?? ''} ${e?.message ?? ''}`;
    if (/WalletDirAlreadyExists|WALLET_DIR_ALREADY_EXISTS|already exists/i.test(why)) {
      throw new Error('This phone already has RGB data for this wallet, so the file wasn’t restored.', { cause: e });
    }
    if (/password|decrypt|InvalidBackup|WrongPassword|WRONG_PASSWORD|UnsupportedBackupVersion/i.test(why)) {
      throw new Error('This backup file isn’t for this wallet, or it’s damaged.', { cause: e });
    }
    throw e;
  }
}
