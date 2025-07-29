import { useSelector } from 'react-redux';
import { RootState } from '../store';

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