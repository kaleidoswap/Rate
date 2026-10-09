import { useCallback, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useAppSelector } from '../store/hooks';
import { selectDisclosureLevel } from '../store/slices/settingsSlice';
import { useAssetInventory } from './useAssetInventory';
import { useFiatRates } from './useFiatRates';
import { inventoryBtc, inventoryTokens } from '../utils/asset-inventory';
import { loadActivity, type AssetMeta } from '../services/ActivityService';
import { bestOffer, prepareKaleidoPay, previewInput, quotePaymentOffers, quoteSpend, railLabel } from '../services/kaleidoPay';
import { contactLnAddress, contacts as allContacts, matchContacts } from '../services/walletTools';
import { previewSwapQuote } from '../services/swapTools';
import { localTextModel } from '../services/mindIntents/model';
import { runIntent, type IntentOutcome } from '../services/mindIntents/run';
import type { CardDeps } from '../services/mindIntents/card';
import type { BalanceInput } from '../services/mindIntents/questions';

async function quoteSend(destination: string, amountSat: number) {
  await prepareKaleidoPay();
  const preview = await previewInput(destination, amountSat, Crypto.randomUUID());
  if (preview.plan.status !== 'ready') throw new Error(preview.plan.reason);
  const offers = await quotePaymentOffers(preview);
  const best = bestOffer(offers.filter((o) => o.executable)) ?? bestOffer(offers);
  if (!best?.quote) throw new Error(offers.find((o) => o.unavailable)?.unavailable ?? 'No account can pay this right now.');
  const spend = quoteSpend(best.quote);
  const btc = spend.asset.id === 'BTC';
  return {
    feeSat: btc ? spend.fee : best.quote.feeSat,
    totalSat: btc ? spend.total : best.quote.totalSat,
    route: `${best.accountName} · ${railLabel(best.route.from)}`,
  };
}

/** Turns typed or spoken text into an action card or an answer, with the wallet's live data. */
export function useIntentRunner() {
  const fiat = useAppSelector((s) => s.settings.currency) || 'USD';
  const advanced = useAppSelector(selectDisclosureLevel) !== 'lite';
  const byProtocol = useAppSelector((s) => s.wallet.btcBalance?.byProtocol);
  const rgbAssets = useAppSelector((s) => s.assets.rgbAssets);
  const walletId = useAppSelector((s) => s.wallet.activeWallet?.id);
  const inventory = useAssetInventory();
  const rates = useFiatRates();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<IntentOutcome | null>(null);
  const run = useRef(0);

  const cardDeps = useMemo<CardDeps>(() => {
    const btc = inventoryBtc(inventory);
    const tokens = inventoryTokens(inventory);
    return {
      fiat,
      btcPrice: (c) => rates[c.toLowerCase()],
      balance: (asset) => {
        if (asset === 'BTC') return btc.spendable ?? btc.balance;
        const held = tokens.filter((t) => t.ticker.toUpperCase() === asset.toUpperCase());
        return held.length ? held.reduce((s, t) => s + t.balance / 10 ** (t.precision || 0), 0) : undefined;
      },
      findContacts: (name) => matchContacts(allContacts(), name).map((c: any) => ({
        name: String(c.name), lightning_address: c.lightning_address, pubkey: c.pubkey,
      })),
      contactDestination: (c) => contactLnAddress(c),
      quoteSend,
      quoteSwap: (from, to, amount) => previewSwapQuote(from, to, amount),
    };
  }, [inventory, rates, fiat]);

  const balance = useCallback((): BalanceInput => {
    const byAccount: Record<string, number> = {};
    for (const [id, b] of Object.entries(byProtocol ?? {})) byAccount[id] = (b as any)?.total ?? 0;
    const btc = inventoryBtc(inventory);
    return {
      totalSat: btc.balance,
      byAccount,
      assets: inventoryTokens(inventory).map((t) => ({ ticker: t.ticker, amount: t.balance / 10 ** (t.precision || 0) })),
      advanced,
    };
  }, [byProtocol, inventory, advanced]);

  const activity = useCallback(async () => {
    const assets: AssetMeta[] = (rgbAssets ?? []).map((a: any) => ({
      asset_id: a.asset_id, ticker: a.ticker, name: a.name, precision: a.precision ?? 0, protocol: a.protocol,
    }));
    return (await loadActivity({ assets, walletId, useCache: true })).items;
  }, [rgbAssets, walletId]);

  const submit = useCallback(async (text: string) => {
    const id = ++run.current;
    if (!text.trim()) return;
    setBusy(true);
    try {
      const next = await runIntent(text, { model: localTextModel(), card: cardDeps, balance, activity });
      if (id === run.current) setOutcome(next);
    } catch (e) {
      if (id === run.current) setOutcome({ type: 'none', message: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
    } finally {
      if (id === run.current) setBusy(false);
    }
  }, [cardDeps, balance, activity]);

  const reset = useCallback(() => { run.current++; setBusy(false); setOutcome(null); }, []);

  return { submit, busy, outcome, reset, advanced };
}
