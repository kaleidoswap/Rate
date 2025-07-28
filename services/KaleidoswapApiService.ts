// services/KaleidoswapApiService.ts
import axios, { AxiosInstance, AxiosError } from 'axios';

interface ErrorResponse {
  error?: string;
  message?: string;
}

export interface QuoteRequest {
  from_asset: string;
  to_asset: string;
  from_amount: number;
}

export interface QuoteResponse {
  rfq_id: string;
  from_asset: string;
  to_asset: string;
  from_amount: number;
  to_amount: number;
  fee_amount: number;
  exchange_rate: number;
  expiry_timestamp: number;
  maker_pubkey: string;
}

export interface SwapInitRequest {
  rfq_id: string;
}

export interface SwapInitResponse {
  swap_string: string;
}

export interface TakerRequest {
  swap_string: string;
}

export interface TakerResponse {
  success: boolean;
  message?: string;
}

export interface MakerExecuteRequest {
  rfq_id: string;
}

export interface MakerExecuteResponse {
  success: boolean;
  txid?: string;
  message?: string;
}

export interface SwapStatusResponse {
  status: 'pending' | 'whitelisted' | 'executing' | 'completed' | 'failed';
  txid?: string;
  error?: string;
}

export class KaleidoswapApiService {
  private static instance: KaleidoswapApiService;
  private api: AxiosInstance;
  private readonly baseURL = 'https://api.regtest.kaleidoswap.com';

  private constructor() {
    this.api = this.createApiInstance();
  }

  public static getInstance(): KaleidoswapApiService {
    if (!KaleidoswapApiService.instance) {
      KaleidoswapApiService.instance = new KaleidoswapApiService();
    }
    return KaleidoswapApiService.instance;
  }

  private createApiInstance(): AxiosInstance {
    const api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Add request interceptor for logging
    api.interceptors.request.use(
      (config) => {
        console.log(`Kaleidoswap API Request: ${config.method?.toUpperCase()} ${config.url}`);
        console.log('Request data:', config.data);
        return config;
      },
      (error) => {
        console.error('Kaleidoswap API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    api.interceptors.response.use(
      (response) => {
        console.log(`Kaleidoswap API Response: ${response.status}`, response.data);
        return response;
      },
      (error) => {
        console.error('Kaleidoswap API Error:', error);
        return Promise.reject(this.handleError(error));
      }
    );

    return api;
  }

  private handleError(error: AxiosError): Error {
    if (error.response) {
      const errorData = error.response.data as ErrorResponse;
      const message = errorData?.error || errorData?.message || `HTTP ${error.response.status}: ${error.response.statusText}`;
      
      console.error('Kaleidoswap API Error Response:', {
        status: error.response.status,
        data: error.response.data,
      });
      
      return new Error(message);
    } else if (error.request) {
      console.error('Kaleidoswap API Network Error:', error.request);
      return new Error('Network error: Unable to connect to Kaleidoswap API');
    } else {
      console.error('Kaleidoswap API Unknown Error:', error.message);
      return new Error(`Unknown error: ${error.message}`);
    }
  }

  /**
   * Get a quote for swapping assets
   */
  public async getQuote(params: QuoteRequest): Promise<QuoteResponse> {
    try {
      console.log('Getting quote for swap:', params);
      const response = await this.api.post<QuoteResponse>('/quote', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Initialize a swap with the given RFQ ID
   */
  public async initSwap(params: SwapInitRequest): Promise<SwapInitResponse> {
    try {
      console.log('Initializing swap with RFQ ID:', params.rfq_id);
      const response = await this.api.post<SwapInitResponse>('/swap/init', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Whitelist the trade using the swap string
   */
  public async whitelistTrade(params: TakerRequest): Promise<TakerResponse> {
    try {
      console.log('Whitelisting trade with swap string');
      const response = await this.api.post<TakerResponse>('/taker', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Execute the swap
   */
  public async executeSwap(params: MakerExecuteRequest): Promise<MakerExecuteResponse> {
    try {
      console.log('Executing swap for RFQ ID:', params.rfq_id);
      const response = await this.api.post<MakerExecuteResponse>('/maker/execute', params);
      return response.data;
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Get available assets for swapping
   */
  public async getAvailableAssets(): Promise<string[]> {
    try {
      console.log('Getting available assets for swapping');
      const response = await this.api.get<{ assets: string[] }>('/assets');
      return response.data.assets || [];
    } catch (error) {
      console.warn('Failed to get available assets, returning defaults:', error);
      // Return default assets if API fails
      return ['BTC', 'USD', 'EUR'];
    }
  }

  /**
   * Get market rates for asset pairs
   */
  public async getMarketRates(): Promise<Record<string, Record<string, number>>> {
    try {
      console.log('Getting market rates');
      const response = await this.api.get<{ rates: Record<string, Record<string, number>> }>('/rates');
      return response.data.rates || {};
    } catch (error) {
      console.warn('Failed to get market rates:', error);
      return {};
    }
  }

  /**
   * Get swap history for a given pubkey/address
   */
  public async getSwapHistory(pubkey: string): Promise<any[]> {
    try {
      console.log('Getting swap history for pubkey:', pubkey);
      const response = await this.api.get<{ swaps: any[] }>(`/history/${pubkey}`);
      return response.data.swaps || [];
    } catch (error) {
      console.warn('Failed to get swap history:', error);
      return [];
    }
  }
}

export default KaleidoswapApiService; 