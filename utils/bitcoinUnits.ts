import { useSelector } from 'react-redux';
import { useState, useEffect } from 'react';
import { RootState } from '../store';
import PriceService from '../services/PriceService';

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

export function formatBitcoinAmount(amount: string | number, unit: 'BTC' | 'sats'): string {
  const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(amountNum)) return '0';
  
  if (unit === 'sats') {
    // If input is in BTC, convert to sats
    if (amountNum < 1) {
      return btcToSats(amountNum);
    }
    // Input is already in sats
    return Math.floor(amountNum).toString();
  } else {
    // If input is in sats, convert to BTC
    if (amountNum > 1000) {
      return satsToBtc(amountNum);
    }
    // Input is already in BTC
    return amountNum.toFixed(8);
  }
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