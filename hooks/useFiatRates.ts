// hooks/useFiatRates.ts
import { useEffect, useRef, useState } from 'react';
import PriceService from '../services/PriceService';

/** Fiat currencies offered in the amount editor. */
export const SUPPORTED_FIATS = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type FiatCode = (typeof SUPPORTED_FIATS)[number];

export const FIAT_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF',
  JPY: '¥',
  CAD: 'C$',
  AUD: 'A$',
};

/**
 * Live BTC→fiat rates for the supported currencies.
 * Returns a lowercase-keyed map (e.g. { usd: 65000, eur: 60000 }) and refreshes
 * every 60s. Empty until the first fetch resolves.
 */
export function useFiatRates(currencies: readonly string[] = SUPPORTED_FIATS) {
  const [rates, setRates] = useState<Record<string, number>>({});
  // Stable key so the effect doesn't re-run on every render from a new array ref.
  const key = currencies.join(',');
  const currenciesRef = useRef(currencies);
  currenciesRef.current = currencies;

  useEffect(() => {
    let cancelled = false;
    const svc = PriceService.getInstance();

    const update = async () => {
      try {
        const next = await svc.getBitcoinRates([...currenciesRef.current]);
        if (!cancelled) setRates(next);
      } catch (e) {
        // PriceService already logs + falls back; nothing to do here.
      }
    };

    update();
    const id = setInterval(update, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key]);

  return rates;
}
