import { useSelector, useDispatch } from 'react-redux';
import { useState, useEffect } from 'react';
import { RootState } from '../store';
import PriceService from '../services/PriceService';
import {
  selectDisplayDenomination,
  cycleDisplayDenomination,
  type DisplayDenomination,
} from '../store/slices/settingsSlice';

const SATS_PER_BTC = 100000000;

export function btcToSats(btc: string | number): string {
  const btcNum = typeof btc === 'string' ? parseFloat(btc) : btc;
  if (isNaN(btcNum)) return '0';
  return Math.floor(btcNum * SATS_PER_BTC).toString();
}

export function satsToBtc(sats: string | number): string {
  const satsNum = typeof sats === 'string' ? parseFloat(sats) : sats;
  if (isNaN(satsNum)) return '0';
  return (satsNum / SATS_PER_BTC).toFixed(8);
}

/**
 * Formats an on-chain / channel amount for display.
 *
 * INPUT IS ALWAYS SATOSHIS (the protocol-native unit). The `unit` argument only
 * controls how the value is rendered, never how the input is interpreted.
 * Do NOT pass BTC values here — convert to sats first.
 *
 * The previous implementation guessed the input unit from the magnitude of the
 * value (`< 1` → BTC, `> 1000` → sats), which silently mis-rendered any balance
 * of 1 BTC or more (e.g. 2 BTC arrived as `2` and was rendered as "2 sats").
 */
export function formatBitcoinAmount(sats: string | number, unit: 'BTC' | 'sats'): string {
  const satsNum = typeof sats === 'string' ? parseFloat(sats) : sats;
  if (!isFinite(satsNum)) return '0';

  if (unit === 'sats') {
    return Math.round(satsNum).toLocaleString('en-US');
  }
  return (satsNum / SATS_PER_BTC).toFixed(8);
}

// Keep the hook for components that need to react to unit changes
export function useFormattedBitcoinAmount(amount: string | number): string {
  const bitcoinUnit = useSelector((state: RootState) => state.settings.bitcoinUnit);
  return formatBitcoinAmount(amount, bitcoinUnit);
}

export function parseInputAmount(input: string, unit: 'BTC' | 'sats'): string {
  const num = parseFloat(input);
  if (isNaN(num)) return '0';
  
  return unit === 'sats' ? Math.floor(num).toString() : num.toFixed(8);
}

export function convertAmountToUnit(amount: string | number, fromUnit: 'BTC' | 'sats', toUnit: 'BTC' | 'sats'): string {
  if (fromUnit === toUnit) return amount.toString();
  return fromUnit === 'BTC' ? btcToSats(amount) : satsToBtc(amount);
}

/**
 * Converts satoshis to USD string representation
 * @param satoshis - Amount in satoshis (always assumes input is in satoshis)
 * @param bitcoinPriceUSD - Bitcoin price in USD per BTC
 * @returns Formatted USD string with 2 decimal places
 */
export function formatSatoshisToUSD(satoshis: string | number, bitcoinPriceUSD: number): string {
  const satsNum = typeof satoshis === 'string' ? parseFloat(satoshis) : satoshis;
  if (isNaN(satsNum) || !bitcoinPriceUSD) return '0.00';
  
  // Always convert satoshis to BTC first, then multiply by USD price
  const btc = satsNum / SATS_PER_BTC;
  const usd = btc * bitcoinPriceUSD;
  return usd.toFixed(2);
}

/**
 * Custom hook that provides Bitcoin price data
 */
export function useBitcoinPrice() {
  const [bitcoinPrice, setBitcoinPrice] = useState<number>(0);

  useEffect(() => {
    let priceIntervalId: NodeJS.Timeout;

    const updatePrice = async () => {
      try {
        const priceService = PriceService.getInstance();
        const price = await priceService.getBitcoinPrice();
        setBitcoinPrice(price);
      } catch (error) {
        console.error('Failed to fetch Bitcoin price:', error);
        if (!bitcoinPrice) {
          setBitcoinPrice(0);
        }
      }
    };

    // Initial price fetch
    updatePrice();

    // Update price every 30 seconds
    priceIntervalId = setInterval(updatePrice, 30000);

    return () => {
      if (priceIntervalId) {
        clearInterval(priceIntervalId);
      }
    };
  }, []);

  return bitcoinPrice;
}

/**
 * Custom hook that provides Bitcoin conversion utilities with live price data
 */
export function useBitcoinConversion() {
  const bitcoinPrice = useBitcoinPrice();

  const formatSatoshisToUSDWithPrice = (satoshis: string | number): string => {
    return formatSatoshisToUSD(satoshis, bitcoinPrice);
  };

  return {
    bitcoinPrice,
    formatSatoshisToUSD: formatSatoshisToUSDWithPrice,
  };
}

const HIDDEN_PLACEHOLDER = '••••••';

export interface DenominatedAmount {
  /** Main figure, e.g. "12,345", "0.00012345", or "$8.50". */
  primary: string;
  /** Unit shown next to the primary figure: "sats" | "BTC" | currency code; "" when hidden or fiat-embedded. */
  unitLabel: string;
  /** The alternate representation, for a smaller sub-line (e.g. "$8.50 USD" or "12,345 sats"). */
  secondary: string;
  /** True when balances are hidden for privacy. */
  hidden: boolean;
}

/**
 * Formats a satoshi amount for display in the chosen denomination, returning
 * both the primary figure and a secondary (alternate) representation.
 *
 * Pure: pass the live `price`/`currency` in. `sats` is ALWAYS satoshis. When
 * `fiat` is requested but no price is available, it degrades to `sats` rather
 * than rendering a misleading $0.
 */
export function formatDenominatedAmount(
  sats: string | number,
  opts: {
    denomination: DisplayDenomination;
    currency?: string;
    price?: number;
    hideBalances?: boolean;
  },
): DenominatedAmount {
  const { denomination, currency = 'USD', price = 0, hideBalances = false } = opts;

  if (hideBalances) {
    return { primary: HIDDEN_PLACEHOLDER, unitLabel: '', secondary: '', hidden: true };
  }

  const satsNum = typeof sats === 'string' ? parseFloat(sats) : sats;
  const safeSats = isFinite(satsNum) ? satsNum : 0;

  const fiatFigure = (): string => {
    const usd = parseFloat(formatSatoshisToUSD(safeSats, price));
    return usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Fiat is only meaningful with a live price; otherwise fall back to sats.
  const effective: DisplayDenomination =
    denomination === 'fiat' && !price ? 'sats' : denomination;

  switch (effective) {
    case 'BTC':
      return {
        primary: formatBitcoinAmount(safeSats, 'BTC'),
        unitLabel: 'BTC',
        secondary: price ? `$${fiatFigure()} ${currency}` : '',
        hidden: false,
      };
    case 'fiat':
      return {
        primary: `$${fiatFigure()}`,
        unitLabel: currency,
        secondary: `${formatBitcoinAmount(safeSats, 'sats')} sats`,
        hidden: false,
      };
    case 'sats':
    default:
      return {
        primary: formatBitcoinAmount(safeSats, 'sats'),
        unitLabel: 'sats',
        secondary: price ? `$${fiatFigure()} ${currency}` : '',
        hidden: false,
      };
  }
}

/**
 * Hook that formats amounts in the user's chosen display denomination and lets
 * the UI cycle it (sats → BTC → fiat → sats) on tap. Reads denomination,
 * currency, privacy and live price from the store.
 */
export function useDisplayAmount() {
  const dispatch = useDispatch();
  const denomination = useSelector(selectDisplayDenomination);
  const currency = useSelector((s: RootState) => s.settings.currency);
  const hideBalances = useSelector((s: RootState) => s.settings.hideBalances);
  const price = useBitcoinPrice();

  const format = (sats: string | number): DenominatedAmount =>
    formatDenominatedAmount(sats, { denomination, currency, price, hideBalances });

  const cycle = () => dispatch(cycleDisplayDenomination());

  return { format, cycle, denomination, price };
}