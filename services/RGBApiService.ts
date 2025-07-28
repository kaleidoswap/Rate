// services/RGBApiService.ts
import axios, { AxiosInstance } from 'axios';
import RGBNodeService from './RGBNodeService';

enum AssetSchema {
  Nia = 'Nia',
  Uda = 'Uda',
  Cfa = 'Cfa',
}

enum BitcoinNetwork {
  Mainnet = 'Mainnet',
  Testnet = 'Testnet',
  Signet = 'Signet',
  Regtest = 'Regtest',
}

interface Token {
  index: number;
  ticker: string;
  name: string;
  details?: string;
  embedded_media?: EmbeddedMedia;
  media?: Media;
  attachments?: Record<number, Media>;
  reserves?: ProofOfReserves;
}

interface EmbeddedMedia {
  mime: string;
  data: number[];
}

interface Media {
  file_path: string;
  mime: string;
}

interface ProofOfReserves {
  utxo: string;
  proof: number[];
}

interface Assignment {
  type: 'Fungible' | 'NonFungible' | 'InflationRight' | 'ReplaceRight' | 'Any';
  value?: number;
}

interface AssignmentFungible extends Assignment {
  type: 'Fungible';
  value: number;
}

interface AssetCFA {
  asset_id: string;
  name: string;
  details?: string;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: AssetBalanceResponse;
  media?: Media;
}

interface AssetUDA {
  asset_id: string;
  ticker: string;
  name: string;
  details?: string;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: AssetBalanceResponse;
  token?: Token;
}

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

interface BTCBalanceResponse {
  vanilla: {
    settled: number;
    future: number;
    spendable: number;
  };
  colored: {
    settled: number;
    future: number;
    spendable: number;
  };
}

interface AssetBalanceRequest {
  asset_id: string;
}

interface AssetBalanceResponse {
  settled: number;
  future: number;
  spendable: number;
  offchain_outbound: number;
  offchain_inbound: number;
}

interface AssetMetadataRequest {
  asset_id: string;
}

interface AssetMetadataResponse {
  asset_schema: AssetSchema;
  issued_supply: number;
  timestamp: number;
  name: string;
  precision: number;
  ticker?: string;
  details?: string;
  token?: Token;
}

interface CreateUtxosRequest {
  up_to: boolean;
  num: number;
  size: number;
  fee_rate: number;
  skip_sync: boolean;
}

interface DecodeRGBInvoiceRequest {
  invoice: string;
}

interface DecodeRGBInvoiceResponse {
  recipient_id: string;
  asset_schema: AssetSchema;
  asset_id: string;
  assignment: Assignment;
  network: BitcoinNetwork;
  expiration_timestamp: number;
  transport_endpoints: string[];
}

interface FailTransfersRequest {
  batch_transfer_idx?: number;
  no_asset_only: boolean;
  skip_sync: boolean;
}

interface FailTransfersResponse {
  transfers_changed: boolean;
}

interface GetAssetMediaRequest {
  digest: string;
}

interface GetAssetMediaResponse {
  bytes_hex: string;
}

interface IssueAssetCFARequest {
  amounts: number[];
  name: string;
  details?: string;
  precision: number;
  file_digest?: string;
}

interface IssueAssetCFAResponse {
  asset: AssetCFA;
}

interface IssueAssetUDARequest {
  ticker: string;
  name: string;
  details?: string;
  precision: number;
  media_file_digest?: string;
  attachments_file_digests?: string[];
}

interface IssueAssetUDAResponse {
  asset: AssetUDA;
}

interface PostAssetMediaRequest {
  file: File;
}

interface PostAssetMediaResponse {
  digest: string;
}

interface RefreshRequest {
  skip_sync: boolean;
}

interface RgbInvoiceRequest {
  min_confirmations: number;
  asset_id: string;
  duration_seconds: number;
}

interface RgbInvoiceResponse {
  recipient_id: string;
  invoice: string;
  expiration_timestamp: number;
  batch_transfer_idx: number;
}

interface SendAssetRequest {
  asset_id: string;
  assignment: AssignmentFungible;
  recipient_id: string;
  donation: boolean;
  fee_rate: number;
  min_confirmations: number;
  transport_endpoints: string[];
  skip_sync: boolean;
}

interface SendAssetResponse {
  txid: string;
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
  public async initializeNode(password: string): Promise<InitResponse> {
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
  public async unlockNode(params: UnlockRequest): Promise<void> {
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
   * Get BTC balance
   */
  public async getBtcBalance(): Promise<BTCBalanceResponse> {
    try {
      console.log('RGB API Request: POST /btcbalance');
      const response = await this.api.post<BTCBalanceResponse>('/btcbalance', {
        skip_sync: false,
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
   * Get node information
   */
  public async getNodeInfo(): Promise<NodeInfoResponse> {
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
  public async listAssets(): Promise<ListAssetsResponse> {
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
  public async issueNiaAsset(
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
   * Get the balance of an asset
   */
  public async getAssetBalance(params: AssetBalanceRequest): Promise<AssetBalanceResponse> {
    try {
      console.log('RGB API Request: POST /assetbalance');
      const response = await this.api.post<AssetBalanceResponse>('/assetbalance', params);
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
   * Get the metadata of an asset
   */
  public async getAssetMetadata(params: AssetMetadataRequest): Promise<AssetMetadataResponse> {
    try {
      console.log('RGB API Request: POST /assetmetadata');
      const response = await this.api.post<AssetMetadataResponse>('/assetmetadata', params);
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
   * Create UTXOs to be used for RGB operations
   */
  public async createUtxos(params: CreateUtxosRequest): Promise<void> {
    try {
      console.log('RGB API Request: POST /createutxos');
      await this.api.post('/createutxos', params);
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
   * Decode an RGB invoice
   */
  public async decodeRGBInvoice(params: DecodeRGBInvoiceRequest): Promise<DecodeRGBInvoiceResponse> {
    try {
      console.log('RGB API Request: POST /decodergbinvoice');
      const response = await this.api.post<DecodeRGBInvoiceResponse>('/decodergbinvoice', params);
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
   * Fail RGB transfers
   */
  public async failTransfers(params: FailTransfersRequest): Promise<FailTransfersResponse> {
    try {
      console.log('RGB API Request: POST /failtransfers');
      const response = await this.api.post<FailTransfersResponse>('/failtransfers', params);
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
   * Get an asset media
   */
  public async getAssetMedia(params: GetAssetMediaRequest): Promise<GetAssetMediaResponse> {
    try {
      console.log('RGB API Request: POST /getassetmedia');
      const response = await this.api.post<GetAssetMediaResponse>('/getassetmedia', params);
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
   * Issue an RGB CFA asset
   */
  public async issueAssetCFA(params: IssueAssetCFARequest): Promise<IssueAssetCFAResponse> {
    try {
      console.log('RGB API Request: POST /issueassetcfa');
      const response = await this.api.post<IssueAssetCFAResponse>('/issueassetcfa', params);
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
   * Issue an RGB UDA asset
   */
  public async issueAssetUDA(params: IssueAssetUDARequest): Promise<IssueAssetUDAResponse> {
    try {
      console.log('RGB API Request: POST /issueassetuda');
      const response = await this.api.post<IssueAssetUDAResponse>('/issueassetuda', params);
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
   * Post an asset media
   */
  public async postAssetMedia(file: File): Promise<PostAssetMediaResponse> {
    try {
      console.log('RGB API Request: POST /postassetmedia');
      const formData = new FormData();
      formData.append('file', file);
      const response = await this.api.post<PostAssetMediaResponse>('/postassetmedia', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
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
   * Refresh RGB pending transfers
   */
  public async refreshTransfers(params: RefreshRequest): Promise<void> {
    try {
      console.log('RGB API Request: POST /refreshtransfers');
      await this.api.post('/refreshtransfers', params);
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
   * Get an RGB invoice
   */
  public async getRGBInvoice(params: RgbInvoiceRequest): Promise<RgbInvoiceResponse> {
    try {
      console.log('RGB API Request: POST /rgbinvoice');
      const response = await this.api.post<RgbInvoiceResponse>('/rgbinvoice', params);
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
   * Send RGB assets
   */
  public async sendAsset(params: SendAssetRequest): Promise<SendAssetResponse> {
    try {
      console.log('RGB API Request: POST /sendasset');
      const response = await this.api.post<SendAssetResponse>('/sendasset', params);
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
   * Sync the RGB wallet
   */
  public async sync(): Promise<void> {
    try {
      console.log('RGB API Request: POST /sync');
      await this.api.post('/sync');
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
  public updateApiConfig(): void {
    const nodeStatus = this.nodeService.getNodeStatus();
    this.api.defaults.baseURL = `http://localhost:${nodeStatus.daemonPort}`;
  }
}

export default RGBApiService;