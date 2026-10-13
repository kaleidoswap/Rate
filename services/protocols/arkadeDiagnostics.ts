import { Platform, Share } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { loadPaymentAttempt } from '../kaleidoPay/attempts';
import { readArkadeHealth } from './arkadeMaintenance';
/** Explicit allowlist: no mnemonic, addresses, invoices, signatures or raw SDK errors. */
export async function arkadeDiagnosticReport(walletId: number): Promise<string> {
  const [health, attempt] = await Promise.allSettled([readArkadeHealth(), loadPaymentAttempt(walletId)]);
  const h = health.status === 'fulfilled' ? health.value : undefined;
  const p = attempt.status === 'fulfilled' && attempt.value?.sourceId.startsWith('arkade') ? attempt.value : undefined;
  return JSON.stringify({ exportedAt: new Date().toISOString(), platform: Platform.OS,
    app: DeviceInfo.getVersion(), build: DeviceInfo.getBuildNumber(),
    health: h ? { checkedAt: h.checkedAt, count: h.count, expiring: h.expiring, persistent: h.persistent,
      delegation: { enabled: h.enabled, serviceVerified: !h.delegateError && h.delegateFee !== undefined, eligible: h.eligible, registered: h.verified, lastAcceptedAt: h.lastDelegatedAt },
      recoverable: h.recoverable, balance: h.balance } : { unavailable: true },
    payment: p ? { status: p.status, source: p.sourceId, network: p.network, createdAt: p.createdAt,
      hasReceipt: !!p.reference, lastCheckedAt: p.lastCheckedAt, checkFailed: p.checkFailed, onchainConfirmed: p.onchainConfirmed } : undefined,
  }, null, 2);
}
export async function shareArkadeDiagnostics(walletId: number): Promise<void> {
  await Share.share({ title: 'Arkade diagnostics', message: await arkadeDiagnosticReport(walletId) });
}
