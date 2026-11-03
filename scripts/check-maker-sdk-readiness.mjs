// Read-only SDK transport smoke. This is not native Android signing or settlement.
import { init, SwapClient } from '@kaleidorg/swap-sdk';
await init();
const client = new SwapClient('https://maker.signet.kaleidoswap.com/v2', 15n);
const kinds = ['submarine', 'reverse', 'chain'];
const books = await Promise.all([client.submarinePairs(), client.reversePairs(), client.chainPairs()]);
const routes = books.flatMap((book, i) => Object.entries(book).flatMap(([from, targets]) => Object.entries(targets).map(([to, p]) => ({ kind: kinds[i], from, to, id: `${kinds[i]}:${from}:${to}`, limitsPresent: typeof p.limits?.minimal === 'bigint' && p.limits.minimal > 0n && p.limits.maximal >= p.limits.minimal }))));
if (routes.some(r => !r.limitsPresent)) throw new Error('SDK returned invalid limits');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), runtime: 'Node on Bolt', readOnly: true, swapsCreated: 0, fundsSent: 0, sdkTransport: 'passed', routes, androidGenericV2Signing: 'not integrated: SDK WASM constructors require a native bridge and durable per-swap recovery' }, null, 2));
