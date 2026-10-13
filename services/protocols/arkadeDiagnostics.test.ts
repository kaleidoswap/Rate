import { arkadeDiagnosticReport } from './arkadeDiagnostics';
jest.mock('./arkadeMaintenance', () => ({ readArkadeHealth: async () => ({ checkedAt: 1, count: 2, expiring: 0, persistent: true, enabled: true, eligible: 2, verified: 1, recoverable: '0', coins: [{ id: 'secret-address' }], delegateError: 'raw error contains sensitive material' }) }));
jest.mock('../kaleidoPay/attempts', () => ({ loadPaymentAttempt: async () => ({ sourceId: 'arkade', status: 'unknown', reference: 'private-txid', recipientName: 'Alice', recipient: '123 sats', detail: 'raw invoice lnbc123', network: 'mainnet', lastCheckedAt: 10 }) }));
jest.mock('react-native-device-info', () => ({ getVersion: () => 'test', getBuildNumber: () => '0' }));
test('diagnostics use an explicit allowlist with no payment identifiers or raw errors', async () => {
  const report = await arkadeDiagnosticReport(1);
  for (const secret of ['private-txid', 'secret-address', 'Alice', 'lnbc123', 'sensitive material']) expect(report).not.toContain(secret);
  expect(JSON.parse(report).payment).toMatchObject({ hasReceipt: true, status: 'unknown', lastCheckedAt: 10 });
});
