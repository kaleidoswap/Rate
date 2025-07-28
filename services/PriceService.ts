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
}

export default PriceService; 