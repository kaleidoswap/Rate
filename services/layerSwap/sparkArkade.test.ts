import { executeLayerSwap, layerSwapNetwork, quoteLayerSwap, type LayerSwapDeps } from './sparkArkade';

const future = () => Math.floor(Date.now() / 1000) + 60;
const offer = (sourceId: string, totalSat: number, over: Record<string, unknown> = {}) => ({
  id: `${sourceId}-${totalSat}`, provider: sourceId === 'arkade' ? 'KaleidoSwap' : 'Lightning', accountName: sourceId,
  route: { kind: sourceId === 'arkade' ? 'swap' : 'direct', sourceId, from: 'x', to: 'ln:mutinynet' },
  quote: { recipientSat: 0, totalSat, feeSat: 0, expiresAt: future(), estimatedSeconds: 30 }, executable: true, ...over,
}) as any;

function deps(over: Partial<LayerSwapDeps> = {}) {
  const sparkAdapter = {
    createInvoice: jest.fn(async () => ({ invoice: 'lntbs-spark' })),
    getInvoiceStatus: jest.fn(async () => ({ status: 'PENDING' })),
  };
  const arkOptions = { network: 'mutinynet', wallet: { ark: 1 }, arkServerUrl: 'https://ark' } as any;
  const d: LayerSwapDeps = {
    prepareKaleidoPay: jest.fn(async () => undefined),
    previewInput: jest.fn(async (_text: string, amountSat?: number) => ({ request: { amountSat } }) as any),
    quotePaymentOffers: jest.fn(async () => [offer('spark-ln', 50_150), offer('arkade', 50_600), offer('arkade', 50_400), offer('rgb-ln', 50_001)]),
    executePaymentOffer: jest.fn(async () => ({ status: 'pending', reference: 'pay-ref' }) as const),
    checkPaymentStatus: jest.fn(async () => ({ status: 'pending' }) as const),
    arkadeReceiveOptions: jest.fn(() => arkOptions),
    createArkadeLightningReceive: jest.fn(async (_o, amountSats) => ({
      rfqId: 'rfq1', invoice: 'lntbs-hold', amountSats, payAmountSats: amountSats + 500, provider: 'KaleidoSwap', expiresAt: future() + 600,
    })),
    claimArkadeLightningReceive: jest.fn(async () => 'settled' as const),
    spark: jest.fn(() => ({ adapter: sparkAdapter, network: 'mutinynet' as const })),
    newId: jest.fn(() => 'id1'),
    ...over,
  };
  return { d, sparkAdapter, arkOptions };
}

describe('layerSwapNetwork', () => {
  it('needs both wallets on one chain', () => {
    expect(layerSwapNetwork(deps().d)).toEqual({ network: 'mutinynet' });
    expect(layerSwapNetwork(deps({ spark: () => null }).d)).toEqual({ unavailable: expect.stringMatching(/Connect Spark/) });
    expect(layerSwapNetwork(deps({ arkadeReceiveOptions: () => null }).d)).toEqual({ unavailable: expect.stringMatching(/Connect Arkade/) });
    const split = deps({ spark: () => ({ adapter: {} as any, network: 'mainnet' }) }).d;
    expect(layerSwapNetwork(split)).toEqual({ unavailable: expect.stringMatching(/different networks/) });
  });
});

describe('Spark → Arkade', () => {
  it('quotes the hold invoice paid from Spark, and claims on Arkade after paying', async () => {
    const { d, arkOptions } = deps();
    const quote = await quoteLayerSwap(d, 'spark-to-arkade', 50_000);
    expect(d.createArkadeLightningReceive).toHaveBeenCalledWith(arkOptions, 50_000);
    expect(d.previewInput).toHaveBeenCalledWith('lntbs-hold', 50_500, 'layer-id1', { networks: ['mutinynet'] });
    expect(quote).toMatchObject({ receiveSat: 50_000, spendSat: 50_150, feeSat: 150, provider: 'KaleidoSwap', network: 'mutinynet' });
    expect(quote.handle.offer.route.sourceId).toBe('spark-ln');

    const steps: string[] = [];
    const outcome = await executeLayerSwap(d, quote, { onStep: s => steps.push(s), intervalMs: 1 });
    expect(outcome).toEqual({ status: 'completed', reference: 'rfq1' });
    expect(d.executePaymentOffer).toHaveBeenCalledWith(quote.handle.preview, quote.handle.offer, 'layer-id1');
    expect(d.claimArkadeLightningReceive).toHaveBeenCalledWith(arkOptions.wallet, 'https://ark', 'rfq1');
    expect(steps).toEqual(['paying', 'claiming']);
  });

  it('refuses a provider that would deliver a different amount', async () => {
    const { d } = deps({ createArkadeLightningReceive: jest.fn(async () => ({ rfqId: 'r', invoice: 'i', amountSats: 49_000, payAmountSats: 50_000, provider: 'P', expiresAt: future() })) });
    await expect(quoteLayerSwap(d, 'spark-to-arkade', 50_000)).rejects.toThrow(/different amount/);
    expect(d.quotePaymentOffers).not.toHaveBeenCalled();
  });

  it('reports a provider that cancelled without retrying the payment', async () => {
    const { d } = deps({ claimArkadeLightningReceive: jest.fn(async () => 'cancelled' as const) });
    const outcome = await executeLayerSwap(d, await quoteLayerSwap(d, 'spark-to-arkade', 50_000), { intervalMs: 1 });
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(d.executePaymentOffer).toHaveBeenCalledTimes(1);
  });

  it('leaves a slow claim to the recovery pass', async () => {
    const { d } = deps({ claimArkadeLightningReceive: jest.fn(async () => 'funded' as const) });
    const outcome = await executeLayerSwap(d, await quoteLayerSwap(d, 'spark-to-arkade', 50_000), { intervalMs: 1, timeoutMs: 5 });
    expect(outcome).toEqual({ status: 'pending', reference: 'rfq1' });
  });
});

describe('Arkade → Spark', () => {
  it('pays a Spark invoice through the cheapest Arkade swap offer', async () => {
    const { d, sparkAdapter } = deps();
    const quote = await quoteLayerSwap(d, 'arkade-to-spark', 50_000);
    expect(sparkAdapter.createInvoice).toHaveBeenCalledWith({ layer: 'BTC_LN', amount: 50_000, description: 'Move from Arkade', expirySeconds: 3600 });
    expect(d.previewInput).toHaveBeenCalledWith('lntbs-spark', 50_000, 'layer-id1', { networks: ['mutinynet'] });
    expect(quote).toMatchObject({ receiveSat: 50_000, spendSat: 50_400, feeSat: 400, provider: 'KaleidoSwap' });
    expect(quote.handle.offer.route.sourceId).toBe('arkade');

    sparkAdapter.getInvoiceStatus.mockResolvedValueOnce({ status: 'PENDING' }).mockResolvedValueOnce({ status: 'PAID' });
    const outcome = await executeLayerSwap(d, quote, { intervalMs: 1 });
    expect(outcome).toEqual({ status: 'completed', reference: 'pay-ref' });
    expect(d.createArkadeLightningReceive).not.toHaveBeenCalled();
  });

  it('says why when no Arkade provider can quote', async () => {
    const { d } = deps({ quotePaymentOffers: jest.fn(async () => [offer('arkade', 0, { quote: undefined, unavailable: 'Insufficient Arkade balance (50,400 sats needed).' })]) });
    await expect(quoteLayerSwap(d, 'arkade-to-spark', 50_000)).rejects.toThrow(/Insufficient Arkade balance/);
  });

  it('reports a refunded swap', async () => {
    const { d } = deps({ checkPaymentStatus: jest.fn(async () => ({ status: 'failed' }) as const) });
    const outcome = await executeLayerSwap(d, await quoteLayerSwap(d, 'arkade-to-spark', 50_000), { intervalMs: 1 });
    expect(outcome).toMatchObject({ status: 'failed', reason: expect.stringMatching(/refunded/) });
  });

  it('stops before paying when the payment is refused outright', async () => {
    const { d } = deps({ executePaymentOffer: jest.fn(async () => ({ status: 'failed', detail: 'No route' }) as const) });
    const outcome = await executeLayerSwap(d, await quoteLayerSwap(d, 'arkade-to-spark', 50_000), { intervalMs: 1 });
    expect(outcome).toEqual({ status: 'failed', reason: 'No route' });
    expect(d.checkPaymentStatus).not.toHaveBeenCalled();
  });
});

it('refuses an expired quote and a bad amount', async () => {
  const { d } = deps();
  await expect(quoteLayerSwap(d, 'arkade-to-spark', 0)).rejects.toThrow(/whole number/);
  const quote = await quoteLayerSwap(d, 'arkade-to-spark', 50_000);
  await expect(executeLayerSwap(d, { ...quote, expiresAt: 1 })).rejects.toThrow(/expired/);
  expect(d.executePaymentOffer).not.toHaveBeenCalled();
});
