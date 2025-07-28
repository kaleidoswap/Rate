// services/RGBApiService.ts
import axios, { AxiosInstance } from 'axios';
import RGBNodeService from './RGBNodeService';

interface RGBApiConfig {
  baseURL: string;
  timeout?: number;
}

interface InitRequest {
  password: string;
}

interface UnlockRequest extends InitRequest {
  bitcoind_rpc_username: string;
  bitcoind_rpc_password: string;
  bitcoind_rpc_host: string;
  bitcoind_rpc_port: number;
  indexer_url: string;
  proxy_endpoint: string;
}

interface InitResponse {
  mnemonic: string;
}

interface ListAssetsResponse {
  nia: NiaAsset[];
}

interface NiaAsset {
  asset_id: string;
  asset_iface: string;
  ticker: string;
  name: string;
  details: string | null;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: Balance;
  media: string | null;
}

interface Balance {
  settled: number;
  future: number;
  spendable: number;
  offchain_outbound?: number;
  offchain_inbound?: number;
}

interface NodeInfoResponse {
  pubkey: string;
  num_channels: number;
  num_usable_channels: number;
  local_balance_sat: number;
  pending_outbound_payments_sat: number;
  num_peers: number;
  onchain_pubkey: string;
  max_media_upload_size_mb: number;
}

interface IssueNiaAssetRequest {
  amounts: number[];
  ticker: string;
  name: string;
  precision: number;
}

interface IssueNiaAssetResponse {
  asset: NiaAsset;
}

export class RGBApiService {
  private static instance: RGBApiService;
  private api: AxiosInstance;
  private nodeService: RGBNodeService;

  private constructor() {
    this.nodeService = RGBNodeService.getInstance();
    this.api = this.createApiInstance();
  }

  public static getInstance(): RGBApiService {
    if (!RGBApiService.instance) {
      RGBApiService.instance = new RGBApiService();
    }
    return RGBApiService.instance;
  }

  /**
   * Initialize the RGB node
   */
  async initializeNode(password: string): Promise<InitResponse> {
    try {
      console.log('RGB API Request: POST /init');
      const response = await this.api.post<InitResponse>('/init', { password });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new Error('Network error: Cannot reach RGB Lightning Node. Is it running?');
        }
        throw new Error(`RGB API Error: ${error.response.data?.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Unlock the RGB node
   */
  async unlockNode(params: UnlockRequest): Promise<void> {
    try {
      console.log('RGB API Request: POST /unlock');
      await this.api.post('/unlock', {
        announce_addresses: [],
        announce_alias: '',
        bitcoind_rpc_host: params.bitcoind_rpc_host,
        bitcoind_rpc_password: params.bitcoind_rpc_password,
        bitcoind_rpc_port: params.bitcoind_rpc_port,
        bitcoind_rpc_username: params.bitcoind_rpc_username,
        indexer_url: params.indexer_url,
        password: params.password,
        proxy_endpoint: params.proxy_endpoint,
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new Error('Network error: Cannot reach RGB Lightning Node. Is it running?');
        }
        throw new Error(`RGB API Error: ${error.response.data?.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get node information
   */
  async getNodeInfo(): Promise<NodeInfoResponse> {
    try {
      console.log('RGB API Request: GET /nodeinfo');
      const response = await this.api.get<NodeInfoResponse>('/nodeinfo');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new Error('Network error: Cannot reach RGB Lightning Node. Is it running?');
        }
        throw new Error(`RGB API Error: ${error.response.data?.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * List all assets
   */
  async listAssets(): Promise<ListAssetsResponse> {
    try {
      console.log('RGB API Request: POST /listassets');
      const response = await this.api.post<ListAssetsResponse>('/listassets', {
        filter_asset_schemas: ['Nia']
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new Error('Network error: Cannot reach RGB Lightning Node. Is it running?');
        }
        throw new Error(`RGB API Error: ${error.response.data?.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Issue a new NIA asset
   */
  async issueNiaAsset(
    amounts: number[],
    ticker: string,
    name: string,
    precision: number
  ): Promise<IssueNiaAssetResponse> {
    try {
      console.log('RGB API Request: POST /issueassetnia');
      const response = await this.api.post<IssueNiaAssetResponse>('/issueassetnia', {
        amounts,
        ticker,
        name,
        precision
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new Error('Network error: Cannot reach RGB Lightning Node. Is it running?');
        }
        throw new Error(`RGB API Error: ${error.response.data?.error || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Create a new API instance with the current node configuration
   */
  private createApiInstance(): AxiosInstance {
    const nodeStatus = this.nodeService.getNodeStatus();
    const config: RGBApiConfig = {
      baseURL: `http://localhost:${nodeStatus.daemonPort}`,
      timeout: 30000,
    };

    const api = axios.create(config);

    // Add request interceptor for logging
    api.interceptors.request.use(
      (config) => {
        console.log(`RGB API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('RGB API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (axios.isAxiosError(error)) {
          console.error('RGB API Error:', error.response?.data || error.message);
        } else {
          console.error('RGB API Error:', error);
        }
        return Promise.reject(error);
      }
    );

    return api;
  }

  /**
   * Update the API configuration when node status changes
   */
  updateApiConfig(): void {
    const nodeStatus = this.nodeService.getNodeStatus();
    this.api.defaults.baseURL = `http://localhost:${nodeStatus.daemonPort}`;
  }
}

export default RGBApiService;