#!/usr/bin/env node
/**
 * QVAC P2P provider — run this on a capable machine (e.g. a Mac M4) to serve
 * on-device-AI inference to delegating clients (the phone app).
 *
 * The app (AI Settings → P2P delegation) connects to this provider by its
 * public key over the Hyperswarm DHT — no same-network requirement, the DHT
 * hole-punches across the internet.
 *
 * Usage (from the `rate` project, which already has @qvac/sdk installed):
 *
 *     node scripts/qvac-provider.mjs
 *
 * For a STABLE public key across restarts, set a fixed 32-byte hex seed:
 *
 *     QVAC_HYPERSWARM_SEED=<64-hex-chars> node scripts/qvac-provider.mjs
 *
 * The model used by a client is chosen in the app; the provider loads it on
 * demand when a delegated request arrives, so this script just needs to be
 * running and reachable. (You can optionally pre-load a model below to warm it.)
 */
import { startQVACProvider } from '@qvac/sdk';

async function main() {
  console.log('Starting QVAC provider…');
  const res = await startQVACProvider();

  if (!res.success || !res.publicKey) {
    console.error('❌ Failed to start provider:', res.error ?? 'unknown error');
    process.exit(1);
  }

  console.log('\n✅ QVAC provider is running.');
  console.log('───────────────────────────────────────────────');
  console.log('Public key:\n  ' + res.publicKey);
  console.log('───────────────────────────────────────────────');
  console.log('In the app: AI Assistant → ⚙︎ → P2P delegation → paste this key.');
  if (!process.env.QVAC_HYPERSWARM_SEED) {
    console.log('\n⚠️  No QVAC_HYPERSWARM_SEED set — this key changes on restart.');
    console.log('   Set QVAC_HYPERSWARM_SEED=<64 hex chars> for a stable key.');
  }
  console.log('\nLeave this process running. Ctrl+C to stop.\n');

  // Keep the process alive.
  process.stdin.resume();
}

main().catch((err) => {
  console.error('Provider crashed:', err);
  process.exit(1);
});
