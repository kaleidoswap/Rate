import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStatus } from './orchestra/client';
import {
  isRecordFinal,
  parseHistory,
  upsertRecord,
  type CrossChainRecord,
} from '../utils/crosschain-history';
import { normalizeOrderStatus } from '../utils/bridge-session';

const key = (walletId: number) => `crosschain-history-v1-${walletId}`;

// Saves come from several screens; serialize read-modify-write per process.
let queue: Promise<unknown> = Promise.resolve();

export async function loadCrossChainHistory(walletId: number): Promise<CrossChainRecord[]> {
  try {
    return parseHistory(await AsyncStorage.getItem(key(walletId)));
  } catch {
    return [];
  }
}

export function recordCrossChain(walletId: number | null | undefined, rec: CrossChainRecord | null): Promise<void> {
  if (walletId == null || !rec) return Promise.resolve();
  const run = queue.then(async () => {
    const list = await loadCrossChainHistory(walletId);
    await AsyncStorage.setItem(key(walletId), JSON.stringify(upsertRecord(list, rec)));
  });
  queue = run.catch(() => {});
  return run.catch((e) => console.warn('Cross-chain history: save failed', e));
}

/** Refresh unfinished orders' status, so Activity doesn't show a stale "processing". */
export async function refreshCrossChainHistory(walletId: number): Promise<CrossChainRecord[]> {
  const list = await loadCrossChainHistory(walletId);
  const open = list.filter((r) => !isRecordFinal(r) && r.orderId).slice(0, 5);
  await Promise.all(
    open.map(async (r) => {
      try {
        const order = await getStatus({ id: r.orderId, readToken: r.readToken });
        const status = normalizeOrderStatus(order.status, r.status === 'unpaid' ? 'processing' : r.status);
        if (status !== r.status || order.amountOut) {
          await recordCrossChain(walletId, { ...r, status, amountOutRaw: order.amountOut ?? r.amountOutRaw, updatedAt: Date.now() });
        }
      } catch {
        // Keep the last known status.
      }
    }),
  );
  return open.length ? loadCrossChainHistory(walletId) : list;
}
