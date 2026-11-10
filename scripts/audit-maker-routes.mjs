// Read-only inventory: never creates a swap, invoice, wallet, or transaction.
// Usage: node scripts/audit-maker-routes.mjs [maker URL] > output/maker-routes.json
const base = new URL(process.argv[2] || 'https://maker.signet.kaleidoswap.com');
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Use a maker URL without credentials or query parameters.');
base.pathname = base.pathname.replace(/\/v2\/?$/, '').replace(/\/$/, '');
const paths = ['/v2/info', '/v2/swap/submarine', '/v2/swap/reverse', '/v2/swap/chain', '/v1/card', '/api/v1/market/pairs'];
const endpoints = await Promise.all(paths.map(async path => {
  try {
    const response = await fetch(`${base.href.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(15000) });
    const body = await response.json().catch(() => null);
    return { path, status: response.status, body };
  } catch (error) { return { path, status: null, error: error.message }; }
}));
const routes = [];
for (const kind of ['submarine', 'reverse', 'chain']) {
  const endpoint = endpoints.find(e => e.path === `/v2/swap/${kind}`);
  if (endpoint.status !== 200 || !endpoint.body || typeof endpoint.body !== 'object') continue;
  for (const [from, targets] of Object.entries(endpoint.body)) {
    for (const [to, pair] of Object.entries(targets)) {
      const valid = typeof pair.pairId === 'string' && typeof pair.hash === 'string' && Number.isFinite(pair.rate) && pair.rate > 0 && Number.isSafeInteger(pair.limits?.minimal) && Number.isSafeInteger(pair.limits?.maximal) && pair.limits.minimal > 0 && pair.limits.maximal >= pair.limits.minimal;
      routes.push({ kind, from, to, pairId: pair.pairId, catalogueValid: valid, limits: pair.limits,
        rateIntegration: (kind === 'submarine' && from === 'ARKD' && to === 'BTC') || (kind === 'reverse' && from === 'BTC' && to === 'ARKD')
          ? 'Separate Arkade Intents executor in Send/Receive; v2 publication alone does not prove Intents availability.'
          : 'No generic v2 executor wired to SwapScreen. Do not treat this route as executable there.',
        settlement: 'not-tested' });
    }
  }
}
const report = { checkedAt: new Date().toISOString(), maker: base.href, readOnly: true, endpoints, routes,
  summary: { publishedRoutes: routes.length, validCatalogueRoutes: routes.filter(r => r.catalogueValid).length, settledRoutes: 0,
    legacyRgbEndpointAvailable: endpoints.find(e => e.path === '/api/v1/market/pairs').status === 200 } };
console.log(JSON.stringify(report, null, 2));
if (endpoints.slice(0, 4).some(e => e.status !== 200) || routes.some(r => !r.catalogueValid)) process.exitCode = 1;
