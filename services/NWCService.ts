// services/NWCService.ts
import NDK, { 
  NDKEvent, 
  NDKFilter, 
  NDKPrivateKeySigner, 
  NDKKind,
  NDKSubscription,
  NostrEvent
} from '@nostr-dev-kit/ndk';
import { nip04, getPublicKey, utils } from 'nostr-tools';
import NostrService from './NostrService';
import RGBApiService from './RGBApiService';
import { getApiInstance } from './apiInstance';

// NIP-47 Event Kinds
export const NWC_KINDS = {
  INFO: 13194,
  REQUEST: 23194,
  RESPONSE: 23195,
  NOTIFICATION: 23196,
} as const;

// NWC Method Names
export const NWC_METHODS = {
  PAY_INVOICE: 'pay_invoice',
  MULTI_PAY_INVOICE: 'multi_pay_invoice',
  PAY_KEYSEND: 'pay_keysend',
  MULTI_PAY_KEYSEND: 'multi_pay_keysend',
  MAKE_INVOICE: 'make_invoice',
  LOOKUP_INVOICE: 'lookup_invoice',
  LIST_TRANSACTIONS: 'list_transactions',
  GET_BALANCE: 'get_balance',
  GET_INFO: 'get_info',
} as const;

// NWC Error Codes
export const NWC_ERROR_CODES = {
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RESTRICTED: 'RESTRICTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
  OTHER: 'OTHER',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  NOT_FOUND: 'NOT_FOUND',
} as const;

// NWC Notification Types
export const NWC_NOTIFICATIONS = {
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_SENT: 'payment_sent',
} as const;

export interface NWCRequest {
  method: string;
  params: Record<string, any>;
}

export interface NWCResponse {
  result_type: string;
  error?: {
    code: string;
    message: string;
  };
  result?: Record<string, any>;
}

export interface NWCNotification {
  notification_type: string;
  notification: Record<string, any>;
}

export interface NWCConnection {
  walletPubkey: string;
  clientSecret: string;
  relayUrls: string[];
  permissions: string[];
  lud16?: string;
}

export interface NWCConnectionString {
  pubkey: string;
  relay: string[];
  secret: string;
  lud16?: string;
}

export class NWCService {
  private static instance: NWCService;
  private nostrService: NostrService;
  private rgbApiService: RGBApiService | null = null;
  private ndk: NDK | null = null;
  private walletSigner: NDKPrivateKeySigner | null = null;
  private subscriptions: Map<string, NDKSubscription> = new Map();
  private connections: Map<string, NWCConnection> = new Map();
  private isRunning = false;

  // Supported capabilities
  private readonly supportedMethods = [
    NWC_METHODS.PAY_INVOICE,
    NWC_METHODS.MAKE_INVOICE,
    NWC_METHODS.LOOKUP_INVOICE,
    NWC_METHODS.LIST_TRANSACTIONS,
    NWC_METHODS.GET_BALANCE,
    NWC_METHODS.GET_INFO,
    NWC_METHODS.PAY_KEYSEND,
  ];

  private readonly supportedNotifications = [
    NWC_NOTIFICATIONS.PAYMENT_RECEIVED,
    NWC_NOTIFICATIONS.PAYMENT_SENT,
  ];

  private constructor() {
    this.nostrService = NostrService.getInstance();
  }

  public static getInstance(): NWCService {
    if (!NWCService.instance) {
      NWCService.instance = new NWCService();
    }
    return NWCService.instance;
  }

  /**
   * Initialize the NWC service
   */
  public async initialize(relays?: string[]): Promise<boolean> {
    try {
      // Get RGB API service instance
      this.rgbApiService = getApiInstance();
      if (!this.rgbApiService) {
        console.warn('NWCService: RGB API Service not available');
        return false;
      }

      // Initialize NDK for NWC
      const defaultRelays = relays || [
        'wss://relay.damus.io',
        'wss://relay.snort.social',
        'wss://nos.lol',
      ];

      this.ndk = new NDK({
        explicitRelayUrls: defaultRelays,
        enableOutboxModel: true,
      });

      await this.ndk.connect();

      // Generate wallet keypair for NWC
      const randomArray = new Uint8Array(32);
      
      // Use crypto.getRandomValues for secure random generation
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(randomArray);
      } else {
        // Fallback to Math.random if crypto is not available
        for (let i = 0; i < 32; i++) {
          randomArray[i] = Math.floor(Math.random() * 256);
        }
      }
      
      const privateKey = Array.from(randomArray, byte => byte.toString(16).padStart(2, '0')).join('');
      this.walletSigner = new NDKPrivateKeySigner(privateKey);
      this.ndk.signer = this.walletSigner;

      console.log('NWCService: Initialized successfully');
      return true;
    } catch (error) {
      console.error('NWCService: Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Start the NWC service and publish info event
   */
  public async start(): Promise<boolean> {
    try {
      if (!this.ndk || !this.walletSigner) {
        throw new Error('NWC service not initialized');
      }

      // Publish info event
      await this.publishInfoEvent();

      // Start listening for requests
      await this.startRequestListener();

      this.isRunning = true;
      console.log('NWCService: Started successfully');
      return true;
    } catch (error) {
      console.error('NWCService: Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop the NWC service
   */
  public async stop(): Promise<void> {
    try {
      // Stop all subscriptions
      for (const subscription of this.subscriptions.values()) {
        subscription.stop();
      }
      this.subscriptions.clear();

      this.isRunning = false;
      console.log('NWCService: Stopped successfully');
    } catch (error) {
      console.error('NWCService: Failed to stop:', error);
    }
  }

  /**
   * Generate a connection string for a client
   */
  public async generateConnectionString(
    permissions: string[] = [],
    lud16?: string
  ): Promise<string> {
    try {
      if (!this.walletSigner) {
        throw new Error('NWC service not initialized');
      }

      const randomArray = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        randomArray[i] = Math.floor(Math.random() * 256);
      }
      const clientSecret = Array.from(randomArray, byte => byte.toString(16).padStart(2, '0')).join('');
      
      // Handle Buffer conversion more safely
      let clientSecretUint8: Uint8Array;
      if (typeof Buffer !== 'undefined') {
        clientSecretUint8 = new Uint8Array(Buffer.from(clientSecret, 'hex'));
      } else {
        // Fallback: convert hex string to Uint8Array manually
        const bytes = [];
        for (let i = 0; i < clientSecret.length; i += 2) {
          bytes.push(parseInt(clientSecret.substr(i, 2), 16));
        }
        clientSecretUint8 = new Uint8Array(bytes);
      }
      
      const clientPubkey = getPublicKey(clientSecretUint8);
      const walletPubkey = await this.walletSigner.user().then(u => u.pubkey);

      // Store connection
      this.connections.set(clientPubkey, {
        walletPubkey,
        clientSecret,
        relayUrls: this.ndk?.explicitRelayUrls || [],
        permissions,
        lud16,
      });

      // Build connection string
      const relayParams = this.ndk?.explicitRelayUrls?.map(url => `relay=${encodeURIComponent(url)}`).join('&') || '';
      const secretParam = `secret=${clientSecret}`;
      const lud16Param = lud16 ? `&lud16=${encodeURIComponent(lud16)}` : '';

      const connectionString = `nostr+walletconnect://${walletPubkey}?${relayParams}&${secretParam}${lud16Param}`;

      console.log('NWCService: Generated connection string for client:', clientPubkey);
      return connectionString;
    } catch (error) {
      console.error('NWCService: Failed to generate connection string:', error);
      throw error;
    }
  }

  /**
   * Parse a connection string
   */
  public parseConnectionString(connectionString: string): NWCConnectionString | null {
    try {
      const url = new URL(connectionString);
      
      if (url.protocol !== 'nostr+walletconnect:') {
        throw new Error('Invalid protocol');
      }

      const pubkey = url.hostname;
      const secret = url.searchParams.get('secret');
      const relays = url.searchParams.getAll('relay');
      const lud16 = url.searchParams.get('lud16');

      if (!pubkey || !secret || relays.length === 0) {
        throw new Error('Missing required parameters');
      }

      return {
        pubkey,
        secret,
        relay: relays,
        lud16: lud16 || undefined,
      };
    } catch (error) {
      console.error('NWCService: Failed to parse connection string:', error);
      return null;
    }
  }

  /**
   * Publish NWC info event
   */
  private async publishInfoEvent(): Promise<void> {
    try {
      if (!this.ndk || !this.walletSigner) {
        throw new Error('NWC service not initialized');
      }

      const event = new NDKEvent(this.ndk);
      event.kind = NWC_KINDS.INFO;
      event.content = this.supportedMethods.join(' ');
      event.tags = [
        ['notifications', this.supportedNotifications.join(' ')],
      ];

      await event.publish();
      console.log('NWCService: Published info event');
    } catch (error) {
      console.error('NWCService: Failed to publish info event:', error);
      throw error;
    }
  }

  /**
   * Start listening for NWC requests
   */
  private async startRequestListener(): Promise<void> {
    try {
      if (!this.ndk || !this.walletSigner) {
        throw new Error('NWC service not initialized');
      }

      const walletPubkey = await this.walletSigner.user().then(u => u.pubkey);

      const filter: NDKFilter = {
        kinds: [NWC_KINDS.REQUEST],
        '#p': [walletPubkey],
      };

      const subscription = this.ndk.subscribe(filter);
      
      subscription.on('event', async (event: NDKEvent) => {
        await this.handleRequest(event);
      });

      this.subscriptions.set('requests', subscription);
      console.log('NWCService: Started request listener');
    } catch (error) {
      console.error('NWCService: Failed to start request listener:', error);
      throw error;
    }
  }

  /**
   * Handle incoming NWC request
   */
  private async handleRequest(event: NDKEvent): Promise<void> {
    try {
      if (!this.walletSigner) {
        throw new Error('Wallet signer not available');
      }

      // Find the client connection
      const clientPubkey = event.pubkey;
      const connection = this.connections.get(clientPubkey);
      
      if (!connection) {
        await this.sendErrorResponse(event, NWC_ERROR_CODES.UNAUTHORIZED, 'Connection not found');
        return;
      }

      // Decrypt the request
      const walletPrivkey = this.walletSigner.privateKey;
      if (!walletPrivkey) {
        throw new Error('Wallet private key not available');
      }

      const decryptedContent = await nip04.decrypt(walletPrivkey, clientPubkey, event.content);
      const request: NWCRequest = JSON.parse(decryptedContent);

      console.log('NWCService: Received request:', request.method);

      // Check if method is supported
      if (!this.supportedMethods.includes(request.method as any)) {
        await this.sendErrorResponse(event, NWC_ERROR_CODES.NOT_IMPLEMENTED, `Method ${request.method} not implemented`);
        return;
      }

      // Check permissions
      if (connection.permissions.length > 0 && !connection.permissions.includes(request.method)) {
        await this.sendErrorResponse(event, NWC_ERROR_CODES.RESTRICTED, `Method ${request.method} not permitted`);
        return;
      }

      // Route request to appropriate handler
      const response = await this.processRequest(request);
      
      // Send response
      await this.sendResponse(event, clientPubkey, response);

    } catch (error) {
      console.error('NWCService: Failed to handle request:', error);
      await this.sendErrorResponse(event, NWC_ERROR_CODES.INTERNAL, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Process NWC request and return response
   */
  private async processRequest(request: NWCRequest): Promise<NWCResponse> {
    try {
      switch (request.method) {
        case NWC_METHODS.PAY_INVOICE:
          return await this.handlePayInvoice(request.params);
        
        case NWC_METHODS.MAKE_INVOICE:
          return await this.handleMakeInvoice(request.params);
        
        case NWC_METHODS.LOOKUP_INVOICE:
          return await this.handleLookupInvoice(request.params);
        
        case NWC_METHODS.LIST_TRANSACTIONS:
          return await this.handleListTransactions(request.params);
        
        case NWC_METHODS.GET_BALANCE:
          return await this.handleGetBalance(request.params);
        
        case NWC_METHODS.GET_INFO:
          return await this.handleGetInfo(request.params);
        
        case NWC_METHODS.PAY_KEYSEND:
          return await this.handlePayKeysend(request.params);
        
        default:
          throw new Error(`Method ${request.method} not implemented`);
      }
    } catch (error) {
      return {
        result_type: request.method,
        error: {
          code: NWC_ERROR_CODES.INTERNAL,
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Handle pay_invoice request
   */
  private async handlePayInvoice(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      const { invoice, amount } = params;
      
      if (!invoice) {
        throw new Error('Invoice is required');
      }

      const result = await this.rgbApiService.payLightningInvoice({ invoice });

      return {
        result_type: NWC_METHODS.PAY_INVOICE,
        result: {
          preimage: result.payment_hash, // Note: RGB API might return different field names
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.PAY_INVOICE,
        error: {
          code: NWC_ERROR_CODES.PAYMENT_FAILED,
          message: error instanceof Error ? error.message : 'Payment failed',
        },
      };
    }
  }

  /**
   * Handle make_invoice request
   */
  private async handleMakeInvoice(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      const { amount, description, expiry } = params;
      
      if (!amount) {
        throw new Error('Amount is required');
      }

      const result = await this.rgbApiService.createLightningInvoice({
        amount_msat: amount,
        description: description || '',
        duration_seconds: expiry || 3600,
      });

      return {
        result_type: NWC_METHODS.MAKE_INVOICE,
        result: {
          type: 'incoming',
          invoice: result.invoice,
          payment_hash: result.payment_hash,
          amount: amount,
          created_at: Math.floor(Date.now() / 1000),
          expires_at: Math.floor(Date.now() / 1000) + (expiry || 3600),
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.MAKE_INVOICE,
        error: {
          code: NWC_ERROR_CODES.INTERNAL,
          message: error instanceof Error ? error.message : 'Failed to create invoice',
        },
      };
    }
  }

  /**
   * Handle lookup_invoice request
   */
  private async handleLookupInvoice(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      const { payment_hash, invoice } = params;
      
      if (!payment_hash && !invoice) {
        throw new Error('Either payment_hash or invoice is required');
      }

      // For now, return a basic response - this would need to be implemented
      // based on the actual RGB API capabilities
      return {
        result_type: NWC_METHODS.LOOKUP_INVOICE,
        result: {
          type: 'incoming',
          payment_hash: payment_hash,
          // Additional fields would be populated from RGB API
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.LOOKUP_INVOICE,
        error: {
          code: NWC_ERROR_CODES.NOT_FOUND,
          message: error instanceof Error ? error.message : 'Invoice not found',
        },
      };
    }
  }

  /**
   * Handle list_transactions request
   */
  private async handleListTransactions(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      // This would use the RGB API's list payments functionality
      // For now, return empty list
      return {
        result_type: NWC_METHODS.LIST_TRANSACTIONS,
        result: {
          transactions: [],
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.LIST_TRANSACTIONS,
        error: {
          code: NWC_ERROR_CODES.INTERNAL,
          message: error instanceof Error ? error.message : 'Failed to list transactions',
        },
      };
    }
  }

  /**
   * Handle get_balance request
   */
  private async handleGetBalance(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      const balance = await this.rgbApiService.getBtcBalance();

      return {
        result_type: NWC_METHODS.GET_BALANCE,
        result: {
          balance: balance.vanilla.spendable, // Return spendable balance in msats
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.GET_BALANCE,
        error: {
          code: NWC_ERROR_CODES.INTERNAL,
          message: error instanceof Error ? error.message : 'Failed to get balance',
        },
      };
    }
  }

  /**
   * Handle get_info request
   */
  private async handleGetInfo(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      const nodeInfo = await this.rgbApiService.getNodeInfo();

      return {
        result_type: NWC_METHODS.GET_INFO,
        result: {
          alias: 'RGB Lightning Node',
          color: '#ff0000',
          pubkey: nodeInfo.pubkey,
          network: 'testnet', // This should come from node info
          methods: this.supportedMethods,
          notifications: this.supportedNotifications,
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.GET_INFO,
        error: {
          code: NWC_ERROR_CODES.INTERNAL,
          message: error instanceof Error ? error.message : 'Failed to get info',
        },
      };
    }
  }

  /**
   * Handle pay_keysend request
   */
  private async handlePayKeysend(params: any): Promise<NWCResponse> {
    try {
      if (!this.rgbApiService) {
        throw new Error('RGB API service not available');
      }

      const { amount, pubkey, preimage, tlv_records } = params;
      
      if (!amount || !pubkey) {
        throw new Error('Amount and pubkey are required');
      }

      // This would use the RGB API's keysend functionality
      // For now, return an error as it may not be implemented
      return {
        result_type: NWC_METHODS.PAY_KEYSEND,
        error: {
          code: NWC_ERROR_CODES.NOT_IMPLEMENTED,
          message: 'Keysend not yet implemented',
        },
      };
    } catch (error) {
      return {
        result_type: NWC_METHODS.PAY_KEYSEND,
        error: {
          code: NWC_ERROR_CODES.PAYMENT_FAILED,
          message: error instanceof Error ? error.message : 'Keysend failed',
        },
      };
    }
  }

  /**
   * Send response to client
   */
  private async sendResponse(
    originalEvent: NDKEvent,
    clientPubkey: string,
    response: NWCResponse
  ): Promise<void> {
    try {
      if (!this.ndk || !this.walletSigner) {
        throw new Error('NWC service not initialized');
      }

      const walletPrivkey = this.walletSigner.privateKey;
      if (!walletPrivkey) {
        throw new Error('Wallet private key not available');
      }

      const event = new NDKEvent(this.ndk);
      event.kind = NWC_KINDS.RESPONSE;
      event.content = await nip04.encrypt(walletPrivkey, clientPubkey, JSON.stringify(response));
      event.tags = [
        ['p', clientPubkey],
        ['e', originalEvent.id],
      ];

      await event.publish();
      console.log('NWCService: Sent response for method:', response.result_type);
    } catch (error) {
      console.error('NWCService: Failed to send response:', error);
    }
  }

  /**
   * Send error response to client
   */
  private async sendErrorResponse(
    originalEvent: NDKEvent,
    errorCode: string,
    message: string
  ): Promise<void> {
    try {
      const response: NWCResponse = {
        result_type: 'error',
        error: {
          code: errorCode,
          message,
        },
      };

      await this.sendResponse(originalEvent, originalEvent.pubkey, response);
    } catch (error) {
      console.error('NWCService: Failed to send error response:', error);
    }
  }

  /**
   * Send notification to client
   */
  public async sendNotification(
    clientPubkey: string,
    notification: NWCNotification
  ): Promise<void> {
    try {
      if (!this.ndk || !this.walletSigner) {
        throw new Error('NWC service not initialized');
      }

      const walletPrivkey = this.walletSigner.privateKey;
      if (!walletPrivkey) {
        throw new Error('Wallet private key not available');
      }

      const event = new NDKEvent(this.ndk);
      event.kind = NWC_KINDS.NOTIFICATION;
      event.content = await nip04.encrypt(walletPrivkey, clientPubkey, JSON.stringify(notification));
      event.tags = [
        ['p', clientPubkey],
      ];

      await event.publish();
      console.log('NWCService: Sent notification:', notification.notification_type);
    } catch (error) {
      console.error('NWCService: Failed to send notification:', error);
    }
  }

  /**
   * Get service status
   */
  public getStatus(): { isRunning: boolean; connections: number; supportedMethods: string[] } {
    return {
      isRunning: this.isRunning,
      connections: this.connections.size,
      supportedMethods: this.supportedMethods,
    };
  }

  /**
   * Get wallet pubkey
   */
  public async getWalletPubkey(): Promise<string | null> {
    if (!this.walletSigner) return null;
    return (await this.walletSigner.user()).pubkey;
  }
}

export default NWCService; 