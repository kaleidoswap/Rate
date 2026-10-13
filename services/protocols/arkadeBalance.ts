import { arkadeExitHistory } from './arkadeExitHistory';
/** Match the official wallet: SDK selection defines spendable, not settled + preconfirmed.
 * https://github.com/arkade-os/wallet/blob/61b7cf8/src/providers/wallet.tsx
 */
export interface ArkadeBalance {
  available: number; total: number; boardingConfirmed: number; boardingUnconfirmed: number;
  recoverable: number; pendingRecovery: number; locked: number; exited: number;
}
function sats(value: unknown, required = false): number {
  if (value == null && !required) return 0;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || value == null) throw new Error('Arkade returned an incomplete balance.');
  return n;
}
export function arkadeBalance(raw: any): ArkadeBalance {
  const exited = sats(raw?.unrolled);
  const total = sats(raw?.total, true) - exited;
  const available = sats(raw?.available, true);
  if (total < 0 || available > total) throw new Error('Arkade returned an inconsistent balance.');
  return { available, total, exited, boardingConfirmed: sats(raw?.boarding?.confirmed),
    boardingUnconfirmed: sats(raw?.boarding?.unconfirmed), recoverable: sats(raw?.recoverable),
    pendingRecovery: sats(raw?.pendingRecovery), locked: sats(raw?.gated) + sats(raw?.intentLocked) };
}
/** Compatibility boundary for the engine version that reconstructs available incorrectly. */
export function withArkadeBalance<T extends { getBtcBalance: (...args: any[]) => Promise<any>; listAssets: (...args: any[]) => Promise<any[]> }>(adapter: T): T {
  const list = adapter.listAssets.bind(adapter);
  const extended = adapter as any;
  const status = extended.getPaymentStatus?.bind(adapter);
  const transactions = extended.listTransactions?.bind(adapter);
  if (status) extended.getPaymentStatus = async (reference: string) => {
    const history = await extended.rawWallet.getTransactionHistory();
    const sent = history.find((tx: any) => tx.type === 'SENT' && tx.key?.arkTxid === reference);
    // Official wallet marks SENT Ark transfers complete independently of batch settlement.
    return sent ? { paymentHash: reference, status: 'confirmed', amount: Math.abs(sent.amount) } : status(reference);
  };
  if (transactions) extended.listTransactions = async (...args: any[]) => {
    const [rows, history] = await Promise.all([transactions(...args), extended.rawWallet.getTransactionHistory()]);
    const sent = new Set(history.filter((tx: any) => tx.type === 'SENT' && tx.key?.arkTxid).map((tx: any) => tx.key.arkTxid));
    const exits = await arkadeExitHistory(extended.rawWallet);
    return [...rows.map((row: any) => sent.has(row.id) ? { ...row, status: 'confirmed' } : row), ...exits];
  };
  adapter.getBtcBalance = async () => {
    const b = arkadeBalance(await (adapter as any).rawWallet.getBalance());
    return { confirmed: b.available, unconfirmed: b.total - b.available, total: b.total };
  };
  adapter.listAssets = async (...args) => {
    const [assets, raw] = await Promise.all([list(...args), (adapter as any).rawWallet.getBalance()]);
    const b = arkadeBalance(raw);
    return assets.map(asset => {
      if (asset.id !== 'BTC') {
        const available = sats(raw.availableAssets?.find((a: any) => a.assetId === asset.id)?.amount);
        return { ...asset, balance: { ...asset.balance, available, availableDisplay: String(available / 10 ** asset.precision) } };
      }
      return { ...asset, balance: { ...asset.balance, total: b.total, available: b.available,
        pending: b.boardingConfirmed + b.boardingUnconfirmed + b.pendingRecovery, locked: b.locked,
        totalDisplay: String(b.total / 1e8), availableDisplay: String(b.available / 1e8) },
        metadata: { ...asset.metadata, ...b } };
    });
  };
  return adapter;
}
