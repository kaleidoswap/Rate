// services/PriceService.ts
interface BitcoinPrice {
  usd: number;
  timestamp: number;
}

class PriceService {
  private static instance: PriceService;
  private cache: BitcoinPrice | null = null;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  private constructor() {}

  static getInstance(): PriceService {
    if (!PriceService.instance) {
      PriceService.instance = new PriceService();
    }
    return PriceService.instance;
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp < this.CACHE_DURATION;
  }

  private async fetchFromCoinGecko(): Promise<number> {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
    );
    if (!response.ok) throw new Error('CoinGecko API error');
    const data = await response.json();
    return data.bitcoin.usd;
  }

  private async fetchFromBinance(): Promise<number> {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (!response.ok) throw new Error('Binance API error');
    const data = await response.json();
    return parseFloat(data.price);
  }

  private async fetchFromKraken(): Promise<number> {
    const response = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD');
    if (!response.ok) throw new Error('Kraken API error');
    const data = await response.json();
    return parseFloat(data.result.XXBTZUSD.c[0]);
  }

  async getBitcoinPrice(): Promise<number> {
    try {
      // Return cached price if valid
      if (this.isCacheValid() && this.cache) {
        return this.cache.usd;
      }

      // Try different APIs in sequence
      const apis = [
        this.fetchFromBinance,
        this.fetchFromCoinGecko,
        this.fetchFromKraken
      ];

      for (const api of apis) {
        try {
          const price = await api.call(this);
          this.cache = {
            usd: price,
            timestamp: Date.now()
          };
          return price;
        } catch (error) {
          console.warn('API fetch failed:', error);
          continue;
        }
      }

      // If all APIs fail and we have a cached price, return it even if expired
      if (this.cache) {
        console.warn('Using expired cache as fallback');
        return this.cache.usd;
      }

      throw new Error('All price APIs failed');
    } catch (error) {
      console.error('Failed to fetch Bitcoin price:', error);
      return this.cache?.usd || 0;
    }
  }

  // ── Multi-fiat rates (BTC priced in several fiat currencies) ──────────────
  private ratesCache: { rates: Record<string, number>; timestamp: number } | null = null;
  private readonly RATES_CACHE_DURATION = 60000; // 60 seconds

  /**
   * Fetch the BTC price in several fiat currencies at once (CoinGecko).
   * Returns a lowercase-keyed map, e.g. { usd: 65000, eur: 60000 }.
   * Falls back to the last good cache (and the single USD price) on failure.
   */
  async getBitcoinRates(currencies: string[]): Promise<Record<string, number>> {
    const wanted = currencies.map((c) => c.toLowerCase());
    const cacheValid =
      this.ratesCache && Date.now() - this.ratesCache.timestamp < this.RATES_CACHE_DURATION;
    if (cacheValid && wanted.every((c) => this.ratesCache!.rates[c] != null)) {
      return this.ratesCache!.rates;
    }

    try {
      const vs = encodeURIComponent(wanted.join(','));
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${vs}`
      );
      if (!response.ok) throw new Error('CoinGecko rates API error');
      const data = await response.json();
      const rates: Record<string, number> = { ...(this.ratesCache?.rates || {}) };
      for (const [k, v] of Object.entries(data.bitcoin || {})) {
        if (typeof v === 'number') rates[k] = v;
      }
      this.ratesCache = { rates, timestamp: Date.now() };
      return rates;
    } catch (error) {
      console.warn('Failed to fetch multi-fiat rates:', error);
      if (this.ratesCache) return this.ratesCache.rates;
      const usd = await this.getBitcoinPrice();
      return usd ? { usd } : {};
    }
  }
}

export default PriceService; 