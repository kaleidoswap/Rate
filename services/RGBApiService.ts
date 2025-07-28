// services/RGBApiService.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import { RGBNodeService } from './RGBNodeService';

interface ErrorResponse {
  error?: string;
}

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

export interface RGBApiConfig {
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

interface Channel {
  channel_id: string;
  funding_txid: string;
  peer_pubkey: string;
  peer_alias: string;
  short_channel_id: number;
  status: 'Opening' | 'Opened' | 'Closing';
  ready: boolean;
  capacity_sat: number;
  local_balance_sat: number;
  outbound_balance_msat: number;
  inbound_balance_msat: number;
  next_outbound_htlc_limit_msat: number;
  next_outbound_htlc_minimum_msat: number;
  is_usable: boolean;
  public: boolean;
  asset_id: string;
  asset_local_amount: number;
  asset_remote_amount: number;
}

interface ListChannelsResponse {
  channels: Channel[];
}

export class RGBApiService {
  private static instance: RGBApiService;
  private api: AxiosInstance | null = null;
  private nodeService: RGBNodeService;
  private config: RGBApiConfig | null = null;
  private retryCount: number = 3;
  private retryDelay: number = 1000;
  private isInitialized: boolean = false;

  private constructor() {
    this.nodeService = RGBNodeService.getInstance();
  }

  public static getInstance(): RGBApiService {
    if (!RGBApiService.instance) {
      RGBApiService.instance = new RGBApiService();
    }
    return RGBApiService.instance;
  }

  public isApiInitialized(): boolean {
    return this.isInitialized && this.api !== null;
  }

  public initialize(config: RGBApiConfig): void {
    this.config = config;
    this.api = this.createApiInstance();
    this.isInitialized = true;
    console.log('RGB API Service initialized with config:', config);
  }

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.api) {
      throw new Error('RGBApiService must be initialized with a config first');
    }
  }

  private async retryRequest<T>(request: () => Promise<T>): Promise<T> {
    this.ensureInitialized();
    let lastError: Error | null = null;
    
    for (let i = 0; i < this.retryCount; i++) {
      try {
        return await request();
      } catch (error) {
        lastError = error as Error;
        console.warn(`Request failed (attempt ${i + 1}/${this.retryCount}):`, error);
        
        if (i < this.retryCount - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, i)));
        }
      }
    }
    
    throw lastError || new Error('Request failed after retries');
  }

  private handleError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ErrorResponse>;
      if (!axiosError.response) {
        // Network error or no response
        const message = `Network error: Cannot reach RGB Lightning Node at ${this.config?.baseURL}. Please check:
1. The node is running
2. The URL is correct
3. Your network connection is stable`;
        throw new Error(message);
      }
      
      // Server responded with error
      const statusCode = axiosError.response.status;
      const errorMessage = axiosError.response.data?.error || axiosError.message;
      throw new Error(`RGB API Error (${statusCode}): ${errorMessage}`);
    }
    
    // Unknown error
    throw error;
  }

  /**
   * Initialize the RGB node
   */
  public async initializeNode(password: string): Promise<InitResponse> {
    try {
      console.log('RGB API Request: POST /init');
      const response = await this.api!.post<InitResponse>('/init', { password });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Unlock the RGB node
   */
  public async unlockNode(params: UnlockRequest): Promise<void> {
    try {
      console.log('RGB API Request: POST /unlock');
      await this.api!.post('/unlock', {
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
      return this.handleError(error);
    }
  }

  /**
   * Get BTC balance
   */
  public async getBtcBalance(): Promise<BTCBalanceResponse> {
    return this.retryRequest(async () => {
      console.log('RGB API Request: POST /btcbalance');
      const response = await this.api!.post<BTCBalanceResponse>('/btcbalance', {
        skip_sync: false,
      });
      return response.data;
    });
  }

  /**
   * Get node information
   */
  public async getNodeInfo(): Promise<NodeInfoResponse> {
    return this.retryRequest(async () => {
      console.log('RGB API Request: GET /nodeinfo');
      const response = await this.api!.get<NodeInfoResponse>('/nodeinfo');
      return response.data;
    });
  }

  /**
   * List all assets
   */
  public async listAssets(): Promise<ListAssetsResponse> {
    return this.retryRequest(async () => {
      console.log('RGB API Request: POST /listassets');
      const response = await this.api!.post<ListAssetsResponse>('/listassets', {
        filter_asset_schemas: ['Nia']
      });
      return response.data;
    });
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
      const response = await this.api!.post<IssueNiaAssetResponse>('/issueassetnia', {
        amounts,
        ticker,
        name,
        precision
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get the balance of an asset
   */
  public async getAssetBalance(params: AssetBalanceRequest): Promise<AssetBalanceResponse> {
    try {
      console.log('RGB API Request: POST /assetbalance');
      const response = await this.api!.post<AssetBalanceResponse>('/assetbalance', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get the metadata of an asset
   */
  public async getAssetMetadata(params: AssetMetadataRequest): Promise<AssetMetadataResponse> {
    try {
      console.log('RGB API Request: POST /assetmetadata');
      const response = await this.api!.post<AssetMetadataResponse>('/assetmetadata', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create UTXOs to be used for RGB operations
   */
  public async createUtxos(params: CreateUtxosRequest): Promise<void> {
    try {
      console.log('RGB API Request: POST /createutxos');
      await this.api!.post('/createutxos', params);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Decode an RGB invoice
   */
  public async decodeRGBInvoice(params: DecodeRGBInvoiceRequest): Promise<DecodeRGBInvoiceResponse> {
    try {
      console.log('RGB API Request: POST /decodergbinvoice');
      const response = await this.api!.post<DecodeRGBInvoiceResponse>('/decodergbinvoice', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Fail RGB transfers
   */
  public async failTransfers(params: FailTransfersRequest): Promise<FailTransfersResponse> {
    try {
      console.log('RGB API Request: POST /failtransfers');
      const response = await this.api!.post<FailTransfersResponse>('/failtransfers', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get an asset media
   */
  public async getAssetMedia(params: GetAssetMediaRequest): Promise<GetAssetMediaResponse> {
    try {
      console.log('RGB API Request: POST /getassetmedia');
      const response = await this.api!.post<GetAssetMediaResponse>('/getassetmedia', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }
  /**
   * Get a new Bitcoin address
   */
  public async getNewAddress(): Promise<string> {
    try {
      console.log('RGB API Request: POST /address');
      const response = await this.api!.post<string>('/address');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create a Lightning Network invoice
   */
  public async createLightningInvoice(params: {
    amount_msat?: number;
    asset_id?: string;
    asset_amount?: number;
    duration_seconds?: number;
    description?: string;
  }): Promise<{ invoice: string; payment_hash: string }> {
    try {
      console.log('RGB API Request: POST /lninvoice');
      const response = await this.api!.post<{ invoice: string; payment_hash: string }>('/lninvoice', {
        amount_msat: params.amount_msat,
        asset_id: params.asset_id,
        asset_amount: params.asset_amount,
        duration_seconds: params.duration_seconds || 3600,
        description: params.description || 'Lightning payment',
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Pay a Lightning Network invoice
   */
  public async payLightningInvoice(params: { invoice: string }): Promise<{ 
    payment_hash: string; 
    status: string;
  }> {
    try {
      console.log('RGB API Request: POST /lnpay');
      const response = await this.api!.post<{ 
        payment_hash: string; 
        status: string;
      }>('/lnpay', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Send Bitcoin
   */
  public async sendBitcoin(params: {
    address: string;
    amount: number;
    fee_rate: number;
  }): Promise<{ txid: string }> {
    try {
      console.log('RGB API Request: POST /sendbtc');
      const response = await this.api!.post<{ txid: string }>('/sendbtc', {
        address: params.address,
        amount_sat: Math.round(params.amount * 100000000), // Convert BTC to satoshis
        fee_rate: params.fee_rate,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Send RGB Asset
   */
  public async sendRGBAsset(params: {
    asset_id: string;
    address: string;
    amount: number;
  }): Promise<{ txid: string }> {
    try {
      console.log('RGB API Request: POST /sendasset');
      const response = await this.api!.post<{ txid: string }>('/sendasset', {
        asset_id: params.asset_id,
        assignment: {
          type: 'Fungible',
          value: params.amount,
        },
        recipient_id: params.address,
        donation: false,
        fee_rate: 1.0,
        min_confirmations: 1,
        transport_endpoints: ['rpc://127.0.0.1:3000/json-rpc'],
        skip_sync: false,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Estimate transaction fee
   */
  public async estimateFee(params: { blocks: number }): Promise<{ fee_rate: number }> {
    try {
      console.log('RGB API Request: POST /estimatefee');
      const response = await this.api!.post<{ fee_rate: number }>('/estimatefee', {
        blocks: params.blocks,
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Issue an RGB CFA asset
   */
  public async issueAssetCFA(params: IssueAssetCFARequest): Promise<IssueAssetCFAResponse> {
    try {
      console.log('RGB API Request: POST /issueassetcfa');
      const response = await this.api!.post<IssueAssetCFAResponse>('/issueassetcfa', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Issue an RGB UDA asset
   */
  public async issueAssetUDA(params: IssueAssetUDARequest): Promise<IssueAssetUDAResponse> {
    try {
      console.log('RGB API Request: POST /issueassetuda');
      const response = await this.api!.post<IssueAssetUDAResponse>('/issueassetuda', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
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
      const response = await this.api!.post<PostAssetMediaResponse>('/postassetmedia', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Refresh RGB pending transfers
   */
  public async refreshTransfers(params: RefreshRequest): Promise<void> {
    try {
      console.log('RGB API Request: POST /refreshtransfers');
      await this.api!.post('/refreshtransfers', params);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get an RGB invoice
   */
  public async getRGBInvoice(params: RgbInvoiceRequest): Promise<RgbInvoiceResponse> {
    try {
      console.log('RGB API Request: POST /rgbinvoice');
      const response = await this.api!.post<RgbInvoiceResponse>('/rgbinvoice', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Send RGB assets
   */
  public async sendAsset(params: SendAssetRequest): Promise<SendAssetResponse> {
    try {
      console.log('RGB API Request: POST /sendasset');
      const response = await this.api!.post<SendAssetResponse>('/sendasset', params);
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Sync the RGB wallet
   */
  public async sync(): Promise<void> {
    try {
      console.log('RGB API Request: POST /sync');
      await this.api!.post('/sync');
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * List all channels
   */
  public async listChannels(): Promise<ListChannelsResponse> {
    try {
      console.log('RGB API Request: GET /listchannels');
      const response = await this.api!.get<ListChannelsResponse>('/listchannels');
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create a new API instance with the current node configuration
   */
  private createApiInstance(): AxiosInstance {
    if (!this.config) {
      throw new Error('Cannot create API instance without config');
    }

    const api = axios.create({
      ...this.config,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    });

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
        console.error('RGB API Error:', error);
        return Promise.reject(this.handleError(error));
      }
    );

    return api;
  }

  /**
   * Update the API configuration
   */
  public updateConfig(config: RGBApiConfig): void {
    this.config = config;
    this.api = this.createApiInstance();
    this.isInitialized = true;
    console.log('RGB API Service config updated:', config);
  }
}

export default RGBApiService;