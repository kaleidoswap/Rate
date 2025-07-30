// aiAssistantFunctions.ts
import { RGBApiService } from '../services/RGBApiService';
import NostrService from '../services/NostrService';
import PremAI from 'premai';
import { LightningAddress, Invoice } from '@getalby/lightning-tools';
import { getStore } from '../store/storeProvider';

// Initialize PremAI client
const premaiClient = new PremAI({
  apiKey: '', // Your existing PremAI key
});

// Location data from Lugano merchants
import LUGANO_MERCHANTS_DATA from '../assets/lugano-merchants.json';
const LUGANO_MERCHANTS = LUGANO_MERCHANTS_DATA;

// Interface for Nostr contacts
interface NostrContact {
  id?: string;
  name?: string;
  npub?: string;
  lightning_address?: string;
  profile?: {
    display_name?: string;
    name?: string;
    picture?: string;
    [key: string]: any;
  };
  avatar_url?: string;
  [key: string]: any;
}

// Enhanced validation utilities
const validateInput = {
  lightningAddress: (address: string): boolean => {
    if (!address || typeof address !== 'string') return false;
    const parts = address.split('@');
    return parts.length === 2 && parts[0].length > 0 && parts[1].includes('.');
  },
  
  lightningInvoice: (invoice: string): boolean => {
    if (!invoice || typeof invoice !== 'string') return false;
    return invoice.toLowerCase().startsWith('lnbc') || invoice.toLowerCase().startsWith('lntb');
  },
  
  amount: (amount: any): boolean => {
    return typeof amount === 'number' && amount > 0 && amount <= 100000000; // Max 1 BTC in sats
  },
  
  merchantQuery: (query: string): boolean => {
    return typeof query === 'string' && query.trim().length >= 2;
  }
};

// Fuzzy search utility for merchants
const fuzzySearch = (query: string, text: string): number => {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Exact match gets highest score
  if (textLower.includes(queryLower)) {
    return 1;
  }
  
  // Character matching score
  let score = 0;
  let queryIndex = 0;
  
  for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      score += 1;
      queryIndex++;
    }
  }
  
  return score / queryLower.length;
};

// Function definitions for the AI assistant
export const AI_FUNCTIONS = [
  {
    name: 'pay_lightning_invoice',
    description: 'Pay a Lightning Network invoice or send payment to a Lightning address. Uses Alby Lightning Tools for reliable address resolution and supports LNURL-pay.',
    parameters: {
      type: 'object',
      properties: {
        invoice_or_address: {
          type: 'string',
          description: 'Lightning invoice (lnbc...) or Lightning address (user@domain.com format, e.g., alice@getalby.com)'
        },
        amount_sats: {
          type: 'number',
          description: 'Amount in satoshis (required for Lightning addresses, 1-100000000)'
        },
        description: {
          type: 'string',
          description: 'Optional payment description (max 200 characters)'
        }
      },
      required: ['invoice_or_address']
    }
  },
  {
    name: 'generate_invoice',
    description: 'Generate a Lightning Network invoice to receive payment',
    parameters: {
      type: 'object',
      properties: {
        amount_sats: {
          type: 'number',
          description: 'Amount in satoshis (1-100000000)'
        },
        description: {
          type: 'string',
          description: 'Invoice description (max 200 characters)'
        },
        expiry_seconds: {
          type: 'number',
          description: 'Invoice expiry time in seconds (300-86400, default: 3600)'
        },
        asset_id: {
          type: 'string',
          description: 'RGB asset ID if requesting RGB asset payment'
        },
        asset_amount: {
          type: 'number',
          description: 'RGB asset amount if requesting RGB asset payment'
        }
      },
      required: ['amount_sats']
    }
  },
  {
    name: 'find_merchant_locations',
    description: 'Find merchant locations in Lugano that accept Bitcoin payments with fuzzy search capabilities',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for merchant name, type, or location (min 2 characters)'
        },
        category: {
          type: 'string',
          description: 'Merchant category (restaurant, storefront, local_bar, local_cafe, etc.)'
        },
        near_address: {
          type: 'string',
          description: 'Find merchants near this address'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1-20, default: 10)'
        }
      }
    }
  },
  {
    name: 'get_merchant_info',
    description: 'Get detailed information about a specific merchant',
    parameters: {
      type: 'object',
      properties: {
        merchant_id: {
          type: 'number',
          description: 'Merchant ID number'
        },
        merchant_name: {
          type: 'string',
          description: 'Merchant name (min 2 characters)'
        }
      }
    }
  },
  {
    name: 'pay_nostr_contact',
    description: 'Pay a Nostr contact by resolving their Lightning address and sending payment',
    parameters: {
      type: 'object',
      properties: {
        contact_name: {
          type: 'string',
          description: 'Name of the Nostr contact to pay'
        },
        contact_npub: {
          type: 'string',
          description: 'Npub of the Nostr contact to pay'
        },
        amount_sats: {
          type: 'number',
          description: 'Amount in satoshis to send (1-100000000)'
        },
        description: {
          type: 'string',
          description: 'Optional payment description (max 200 characters)'
        }
      },
      required: ['amount_sats']
    }
  }
];

// Function implementations
export class AIAssistantFunctions {
  private rgbApi: RGBApiService;
  private nostrService: NostrService;

  constructor() {
    this.rgbApi = RGBApiService.getInstance();
    this.nostrService = NostrService.getInstance();
  }

  /**
   * Enhanced payment function with better validation and error handling
   */
  async payLightningInvoice({
    invoice_or_address,
    amount_sats,
    description = 'Payment via AI Assistant'
  }: {
    invoice_or_address: string;
    amount_sats?: number;
    description?: string;
  }) {
    try {
      console.log('💸 Processing payment request:', { invoice_or_address, amount_sats, description });

      // Validate inputs
      if (!invoice_or_address || typeof invoice_or_address !== 'string') {
        throw new Error('Invalid invoice or Lightning address format');
      }

      // Trim and clean the input
      invoice_or_address = invoice_or_address.trim();

      // Validate description length
      if (description && description.length > 200) {
        description = description.substring(0, 197) + '...';
      }

      // Check if it's a Lightning address (contains @)
      if (invoice_or_address.includes('@')) {
        if (!validateInput.lightningAddress(invoice_or_address)) {
          throw new Error('Invalid Lightning address format. Please use format: username@domain.com');
        }

        if (!amount_sats || !validateInput.amount(amount_sats)) {
          throw new Error('Amount is required for Lightning address payments and must be between 1 and 100,000,000 sats');
        }
        
        // Use Alby lightning tools to handle Lightning address
        try {
          console.log('🔗 Resolving Lightning address:', invoice_or_address);
          const lightningAddress = new LightningAddress(invoice_or_address);
          
          // Fetch Lightning address data with timeout
          const fetchPromise = lightningAddress.fetch();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Lightning address resolution timeout')), 10000)
          );
          
          await Promise.race([fetchPromise, timeoutPromise]);
          
          // Request invoice with amount and comment
          const invoiceResponse = await lightningAddress.requestInvoice({
            satoshi: amount_sats,
            comment: description || ''
          });
          
          if (!invoiceResponse.paymentRequest) {
            throw new Error('Failed to get payment request from Lightning address');
          }
          
          invoice_or_address = invoiceResponse.paymentRequest;
          console.log('✅ Lightning address resolved successfully');
        } catch (albyError) {
          console.warn('⚠️ Alby lightning tools failed, using fallback:', albyError);
          // Fallback to manual implementation
          try {
            invoice_or_address = await this.resolveLightningAddressManual(
              invoice_or_address, 
              amount_sats, 
              description
            );
          } catch (fallbackError) {
            throw new Error(`Failed to resolve Lightning address: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
          }
        }
      } else if (!validateInput.lightningInvoice(invoice_or_address)) {
        throw new Error('Invalid Lightning invoice format. Invoice should start with "lnbc" or "lntb"');
      }

      // Validate the invoice before attempting payment
      try {
        const invoiceInfo = await this.getInvoiceInfo(invoice_or_address);
        if (invoiceInfo.isExpired) {
          throw new Error('Lightning invoice has expired');
        }
        console.log('📋 Invoice validated:', { 
          amount: invoiceInfo.satoshi, 
          expires: invoiceInfo.expiryDate?.toISOString() 
        });
      } catch (validationError) {
        console.warn('⚠️ Invoice validation failed:', validationError);
        // Continue with payment attempt as validation might fail for valid invoices
      }

      // Pay the invoice using RGB Lightning Node
      console.log('⚡ Attempting payment...');
      const result = await this.rgbApi.payLightningInvoice({
        invoice: invoice_or_address
      });

      console.log('✅ Payment successful:', result);

      return {
        success: true,
        payment_hash: result.payment_hash,
        status: result.status,
        amount_sats: amount_sats,
        recipient: invoice_or_address.includes('@') ? invoice_or_address : 'Lightning invoice',
        message: `💸 Payment ${result.status.toLowerCase()}! Transaction completed successfully.`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Payment error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      
      return {
        success: false,
        error: errorMessage,
        message: `❌ Payment failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        troubleshooting: this.getPaymentTroubleshooting(errorMessage)
      };
    }
  }

  /**
   * Get troubleshooting tips based on error message
   */
  private getPaymentTroubleshooting(error: string): string {
    if (error.includes('insufficient funds') || error.includes('balance')) {
      return 'Check your wallet balance and ensure you have enough funds for the payment plus fees.';
    }
    if (error.includes('route') || error.includes('path')) {
      return 'No payment route found. The recipient might be offline or have insufficient liquidity.';
    }
    if (error.includes('timeout')) {
      return 'Payment timed out. Check your internet connection and try again.';
    }
    if (error.includes('expired')) {
      return 'Request a new invoice from the recipient as the current one has expired.';
    }
    if (error.includes('address')) {
      return 'Check the Lightning address format (should be like: username@domain.com).';
    }
    return 'Check your internet connection and ensure the recipient is available to receive payments.';
  }

  /**
   * Resolve Nostr contact and get their Lightning address
   */
  async resolveNostrContact({
    contact_name,
    contact_npub
  }: {
    contact_name?: string;
    contact_npub?: string;
  }) {
    try {
      console.log('👥 Resolving Nostr contact:', { contact_name, contact_npub });

      // Get the current state from store
      const store = getStore();
      const state = store.getState();
      const nostrContacts = state.nostr.contacts || [];

      let contact;

      // Try to find contact by name first
      if (contact_name) {
        contact = nostrContacts.find((c: NostrContact) => 
          c.name?.toLowerCase().includes(contact_name.toLowerCase()) ||
          c.profile?.display_name?.toLowerCase().includes(contact_name.toLowerCase()) ||
          c.profile?.name?.toLowerCase().includes(contact_name.toLowerCase())
        );
      }

      // If not found by name, try by npub
      if (!contact && contact_npub) {
        contact = nostrContacts.find((c: NostrContact) => c.npub === contact_npub);
      }

      if (!contact) {
        return {
          success: false,
          error: 'Contact not found',
          message: `❌ Could not find Nostr contact${contact_name ? ` "${contact_name}"` : contact_npub ? ` with npub "${contact_npub}"` : ''}`,
          suggestions: contact_name ? this.getSimilarContactSuggestions(contact_name, nostrContacts) : undefined
        };
      }

      // Check if contact has lightning address
      if (!contact.lightning_address) {
        return {
          success: false,
          error: 'No Lightning address',
          message: `❌ Contact "${contact.name || contact.npub}" doesn't have a Lightning address set up`,
          contact: {
            name: contact.name,
            npub: contact.npub,
            profile: contact.profile
          }
        };
      }

      // Validate the lightning address
      const validation = await this.validateLightningAddress(contact.lightning_address);
      if (!validation.valid) {
        return {
          success: false,
          error: 'Invalid Lightning address',
          message: `❌ Contact "${contact.name || contact.npub}" has an invalid Lightning address: ${validation.error}`,
          contact: {
            name: contact.name,
            npub: contact.npub,
            lightning_address: contact.lightning_address
          }
        };
      }

      console.log('✅ Nostr contact resolved successfully:', contact.name);

      return {
        success: true,
        contact: {
          id: contact.id,
          name: contact.name,
          npub: contact.npub,
          lightning_address: contact.lightning_address,
          profile: contact.profile,
          avatar_url: contact.avatar_url || contact.profile?.picture
        },
        message: `✅ Found contact: ${contact.name || contact.npub}`
      };
    } catch (error) {
      console.error('❌ Contact resolution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Contact resolution failed',
        message: '❌ Failed to resolve Nostr contact'
      };
    }
  }

  /**
   * Pay a Nostr contact by resolving their Lightning address
   */
  async payNostrContact({
    contact_name,
    contact_npub,
    amount_sats,
    description = 'Payment to Nostr contact'
  }: {
    contact_name?: string;
    contact_npub?: string;
    amount_sats: number;
    description?: string;
  }) {
    try {
      console.log('💸 Processing payment to Nostr contact:', { contact_name, contact_npub, amount_sats });

      // Validate amount
      if (!validateInput.amount(amount_sats)) {
        throw new Error('Amount must be between 1 and 100,000,000 satoshis');
      }

      // Resolve the contact first
      const contactResolution = await this.resolveNostrContact({ contact_name, contact_npub });
      
      if (!contactResolution.success) {
        return contactResolution;
      }

      const contact = contactResolution.contact!;
      const lightningAddress = contact.lightning_address!;

      // Update description to include contact name
      const paymentDescription = `${description} (to ${contact.name || contact.npub})`;

      // Use the existing payment function to pay the Lightning address
      const paymentResult = await this.payLightningInvoice({
        invoice_or_address: lightningAddress,
        amount_sats,
        description: paymentDescription
      });

      if (paymentResult.success) {
        return {
          ...paymentResult,
          contact: {
            name: contact.name,
            npub: contact.npub,
            lightning_address: contact.lightning_address,
            avatar_url: contact.avatar_url
          },
          message: `💸 Payment sent successfully to ${contact.name || 'Nostr contact'}! ⚡️`,
          payment_type: 'nostr_contact'
        };
      } else {
        return {
          ...paymentResult,
          contact: {
            name: contact.name,
            npub: contact.npub,
            lightning_address: contact.lightning_address
          },
          message: `❌ Payment to ${contact.name || 'Nostr contact'} failed: ${paymentResult.error}`
        };
      }
    } catch (error) {
      console.error('❌ Nostr contact payment error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Payment to contact failed';
      
      return {
        success: false,
        error: errorMessage,
        message: `❌ Payment to Nostr contact failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        troubleshooting: this.getPaymentTroubleshooting(errorMessage)
      };
    }
  }

  /**
   * Get similar contact name suggestions
   */
  private getSimilarContactSuggestions(searchName: string, contacts: NostrContact[], limit: number = 3): string[] {
    return contacts
      .map((c: NostrContact) => ({
        name: c.name || c.profile?.display_name || c.profile?.name || c.npub,
        score: fuzzySearch(searchName.toLowerCase(), (c.name || c.profile?.display_name || c.profile?.name || '').toLowerCase())
      }))
      .filter(result => result.score > 0.3 && result.name)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(result => result.name!)
      .filter((name): name is string => name !== undefined);
  }

  /**
   * Enhanced Lightning address validation
   */
  async validateLightningAddress(address: string): Promise<{ valid: boolean; error?: string; info?: any }> {
    try {
      if (!validateInput.lightningAddress(address)) {
        return { valid: false, error: 'Invalid Lightning address format' };
      }

      const lightningAddress = new LightningAddress(address);
      const fetchPromise = lightningAddress.fetch();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Validation timeout')), 5000)
      );
      
      await Promise.race([fetchPromise, timeoutPromise]);
      
      return { 
        valid: true,
        info: {
          domain: address.split('@')[1],
          username: address.split('@')[0],
          validatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Lightning address validation failed' 
      };
    }
  }

  /**
   * Enhanced invoice information parsing
   */
  async getInvoiceInfo(paymentRequest: string) {
    try {
      const invoice = new Invoice({ pr: paymentRequest });
      return {
        paymentHash: invoice.paymentHash,
        satoshi: invoice.satoshi,
        description: invoice.description,
        createdDate: invoice.createdDate,
        expiryDate: invoice.expiryDate,
        isExpired: invoice.expiryDate && new Date() > invoice.expiryDate,
        network: paymentRequest.toLowerCase().startsWith('lntb') ? 'testnet' : 'mainnet'
      };
    } catch (error) {
      console.error('Error parsing invoice:', error);
      throw new Error(`Invalid payment request: ${error instanceof Error ? error.message : 'Unknown format'}`);
    }
  }

  /**
   * Improved manual Lightning address resolution with better error handling
   */
  private async resolveLightningAddressManual(
    lightningAddress: string,
    amount_sats: number,
    description?: string
  ): Promise<string> {
    const [username, domain] = lightningAddress.split('@');
    console.log(`🔍 Manual resolution for ${username}@${domain}`);
    
    try {
      const lnurlUrl = `https://${domain}/.well-known/lnurlp/${username}`;
      console.log('🌐 Fetching LNURL data from:', lnurlUrl);
      
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 10000);
      
      const lnurlResponse = await fetch(lnurlUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Kaleidoswap-AI-Assistant/1.0'
        },
        signal: abortController.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!lnurlResponse.ok) {
        throw new Error(`LNURL endpoint returned ${lnurlResponse.status}: ${lnurlResponse.statusText}`);
      }
      
      const lnurlData = await lnurlResponse.json();
      
      if (lnurlData.status === 'ERROR') {
        throw new Error(lnurlData.reason || 'LNURL endpoint returned error');
      }
      
      // Validate amount is within limits
      if (lnurlData.minSendable && amount_sats * 1000 < lnurlData.minSendable) {
        throw new Error(`Amount too small. Minimum: ${Math.ceil(lnurlData.minSendable / 1000)} sats`);
      }
      
      if (lnurlData.maxSendable && amount_sats * 1000 > lnurlData.maxSendable) {
        throw new Error(`Amount too large. Maximum: ${Math.floor(lnurlData.maxSendable / 1000)} sats`);
      }
      
      // Request invoice from LNURL endpoint
      const invoiceUrl = lnurlData.callback + 
        `?amount=${amount_sats * 1000}&comment=${encodeURIComponent(description || '')}`;
      
      console.log('💰 Requesting invoice from:', invoiceUrl);
      
      const invoiceAbortController = new AbortController();
      const invoiceTimeoutId = setTimeout(() => invoiceAbortController.abort(), 10000);
      
      const invoiceResponse = await fetch(invoiceUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Kaleidoswap-AI-Assistant/1.0'
        },
        signal: invoiceAbortController.signal
      });
      
      clearTimeout(invoiceTimeoutId);
      
      if (!invoiceResponse.ok) {
        throw new Error(`Invoice request failed: ${invoiceResponse.status} ${invoiceResponse.statusText}`);
      }
      
      const invoiceData = await invoiceResponse.json();
      
      if (invoiceData.status === 'ERROR') {
        throw new Error(invoiceData.reason || 'Failed to generate invoice');
      }
      
      if (!invoiceData.pr) {
        throw new Error('No payment request in response');
      }
      
      console.log('✅ Manual resolution successful');
      return invoiceData.pr;
    } catch (error) {
      console.error('❌ Manual resolution failed:', error);
      throw error;
    }
  }

  /**
   * Enhanced invoice generation with better validation
   */
  async generateInvoice({
    amount_sats,
    description = 'Payment request',
    expiry_seconds = 3600,
    asset_id,
    asset_amount
  }: {
    amount_sats: number;
    description?: string;
    expiry_seconds?: number;
    asset_id?: string;
    asset_amount?: number;
  }) {
    try {
      console.log('🧾 Generating invoice:', { amount_sats, description, expiry_seconds });

      // Validate inputs
      if (!validateInput.amount(amount_sats)) {
        throw new Error('Amount must be between 1 and 100,000,000 satoshis');
      }

      if (description && description.length > 200) {
        description = description.substring(0, 197) + '...';
      }

      if (expiry_seconds < 300 || expiry_seconds > 86400) {
        expiry_seconds = Math.max(300, Math.min(86400, expiry_seconds));
        console.log(`⚠️ Expiry adjusted to ${expiry_seconds} seconds`);
      }

      const invoiceParams = {
        amount_msat: amount_sats * 1000, // Convert sats to millisats
        duration_seconds: expiry_seconds,
        description,
        ...(asset_id && asset_amount && {
          asset_id,
          asset_amount
        })
      };

      const result = await this.rgbApi.createLightningInvoice(invoiceParams);

      console.log('✅ Invoice generated successfully');

      // Format expiry time
      const expiryDate = new Date(Date.now() + expiry_seconds * 1000);
      const expiryTime = expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Format response message with markdown
      const responseMessage = `
⚡️ **Lightning Invoice Generated!**

💰 **Amount:** ${amount_sats.toLocaleString()} sats
${description ? `📝 **Description:** ${description}\n` : ''}⏰ **Expires:** ${expiryTime}

Here's your invoice QR code and details below. You can:
- 📱 Scan the QR code with any Lightning wallet
- 📋 Copy the invoice to clipboard
- 📤 Share the invoice with others

_The invoice will expire in ${Math.floor(expiry_seconds / 60)} minutes. Make sure to pay it before expiration!_
`;

      return {
        success: true,
        invoice: result.invoice,
        payment_hash: result.payment_hash,
        amount_sats,
        description,
        expiry_seconds,
        expires_at: expiryDate.toISOString(),
        qr_data: result.invoice,
        message: responseMessage,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Invoice generation error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Invoice generation failed';
      
      return {
        success: false,
        error: errorMessage,
        message: `❌ **Invoice Generation Failed**\n\n${errorMessage}\n\nPlease try again or contact support if the issue persists.`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Enhanced merchant search with fuzzy matching and better filtering
   */
  async findMerchantLocations({
    query,
    category,
    near_address,
    limit = 10
  }: {
    query?: string;
    category?: string;
    near_address?: string;
    limit?: number;
  } = {}) {
    try {
      console.log('🏪 Searching merchants:', { query, category, near_address, limit });

      // Validate limit
      limit = Math.max(1, Math.min(20, limit || 10));

      let filteredMerchants = [...LUGANO_MERCHANTS];
      let searchResults: Array<{ merchant: any; score: number }> = [];

      // Filter by category first
      if (category) {
        const categoryLower = category.toLowerCase();
        filteredMerchants = filteredMerchants.filter(merchant => 
          merchant.icon === category || 
          merchant.icon === categoryLower ||
          merchant.name.toLowerCase().includes(categoryLower)
        );
      }

      // Apply fuzzy search if query provided
      if (query && validateInput.merchantQuery(query)) {
        const queryLower = query.toLowerCase();
        
        searchResults = filteredMerchants.map(merchant => {
          let score = 0;
          
          // Name matching (highest weight)
          score += fuzzySearch(queryLower, merchant.name) * 3;
          
          // Address matching
          score += fuzzySearch(queryLower, merchant.address) * 2;
          
          // Website matching
          if (merchant.website) {
            score += fuzzySearch(queryLower, merchant.website) * 1;
          }
          
          // Category/icon matching
          score += fuzzySearch(queryLower, merchant.icon || '') * 1.5;
          
          return { merchant, score };
        })
        .filter(result => result.score > 0.3) // Filter out very low matches
        .sort((a, b) => b.score - a.score); // Sort by score descending
        
        filteredMerchants = searchResults.map(result => result.merchant);
      }

      // Limit results
      const results = filteredMerchants.slice(0, limit);

      console.log(`✅ Found ${results.length} merchants out of ${filteredMerchants.length} matches`);

      return {
        success: true,
        merchants: results.map((merchant, index) => ({
          id: merchant.id,
          name: merchant.name,
          address: merchant.address,
          category: merchant.icon,
          phone: merchant.phone,
          website: merchant.website,
          opening_hours: merchant.opening_hours,
          relevance_score: searchResults[index]?.score,
          accepts_bitcoin: true,
          accepts_lightning: true
        })),
        total_found: filteredMerchants.length,
        total_available: LUGANO_MERCHANTS.length,
        search_params: { query, category, limit },
        message: `🏪 Found ${results.length} merchants${query ? ` matching "${query}"` : ''}${category ? ` in category "${category}"` : ''} in Lugano`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Merchant search error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Search failed';
      
      return {
        success: false,
        error: errorMessage,
        message: '❌ Failed to search merchants. Please try again.',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Enhanced merchant info retrieval with better matching
   */
  async getMerchantInfo({
    merchant_id,
    merchant_name
  }: {
    merchant_id?: number;
    merchant_name?: string;
  }) {
    try {
      console.log('📍 Getting merchant info:', { merchant_id, merchant_name });

      let merchant;

      if (merchant_id && typeof merchant_id === 'number') {
        merchant = LUGANO_MERCHANTS.find(m => m.id === merchant_id);
      } else if (merchant_name && typeof merchant_name === 'string' && merchant_name.trim().length >= 2) {
        const searchName = merchant_name.toLowerCase().trim();
        
        // Try exact match first
        merchant = LUGANO_MERCHANTS.find(m => 
          m.name.toLowerCase() === searchName
        );
        
        // If no exact match, try fuzzy search
        if (!merchant) {
          const searchResults = LUGANO_MERCHANTS.map(m => ({
            merchant: m,
            score: fuzzySearch(searchName, m.name.toLowerCase())
          }))
          .filter(result => result.score > 0.5)
          .sort((a, b) => b.score - a.score);
          
          if (searchResults.length > 0) {
            merchant = searchResults[0].merchant;
          }
        }
      }

      if (!merchant) {
        return {
          success: false,
          error: 'Merchant not found',
          message: `❌ Could not find merchant${merchant_name ? ` "${merchant_name}"` : merchant_id ? ` with ID ${merchant_id}` : ''}`,
          suggestions: merchant_name ? this.getSimilarMerchants(merchant_name) : undefined,
          timestamp: new Date().toISOString()
        };
      }

      console.log('✅ Merchant found:', merchant.name);

      return {
        success: true,
        merchant: {
          id: merchant.id,
          name: merchant.name,
          address: merchant.address,
          category: merchant.icon,
          phone: merchant.phone,
          website: merchant.website,
          opening_hours: merchant.opening_hours,
          accepts_bitcoin: true,
          accepts_lightning: true,
          location: {
            country: 'Switzerland',
            city: 'Lugano',
            region: 'Ticino'
          }
        },
        message: `📍 Found merchant: ${merchant.name}`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Merchant info error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get merchant info';
      
      return {
        success: false,
        error: errorMessage,
        message: '❌ Failed to retrieve merchant information',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get similar merchant suggestions
   */
  private getSimilarMerchants(searchName: string, limit: number = 3): string[] {
    return LUGANO_MERCHANTS
      .map(m => ({
        name: m.name,
        score: fuzzySearch(searchName.toLowerCase(), m.name.toLowerCase())
      }))
      .filter(result => result.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(result => result.name);
  }
}

/**
 * Enhanced AI Assistant with improved function calling and better error handling
 */
export class EnhancedAIAssistant {
  private functions: AIAssistantFunctions;
  private premaiClient: PremAI;

  constructor() {
    this.functions = new AIAssistantFunctions();
    this.premaiClient = premaiClient;
  }

  /**
   * Enhanced intent analysis with better pattern matching
   */
  private analyzeUserIntent(message: string): {
    needsFunction: boolean;
    functionName?: string;
    parameters?: any;
    confidence?: number;
  } {
    const lowerMessage = message.toLowerCase().trim();
    console.log('🧠 Analyzing user intent:', lowerMessage);

    // Payment patterns with better regex
    if (/\b(pay|send|transfer)\b/i.test(lowerMessage)) {
      const satoshiMatch = message.match(/(\d+(?:\,\d+)?)\s*(sats?|satoshis?)/i);
      const addressMatch = message.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|((lnbc|lntb)[a-zA-Z0-9]+)/i);
      
      // Check for contact-based payment patterns
      const contactMatch = message.match(/\b(?:pay|send|transfer).*?(?:to|contact|friend)\s+([a-zA-Z0-9._-]+)/i) ||
                           message.match(/\b(?:pay|send)\s+([a-zA-Z0-9._-]+)/i);
      
      if (contactMatch && !addressMatch && satoshiMatch) {
        const amount = parseInt(satoshiMatch[1].replace(/,/g, ''));
        const contactName = contactMatch[1];
        
        // Check if it looks like a contact name (not an email or invoice)
        if (!contactName.includes('@') && !contactName.startsWith('lnbc') && !contactName.startsWith('lntb')) {
          return {
            needsFunction: true,
            functionName: 'pay_nostr_contact',
            parameters: {
              contact_name: contactName,
              amount_sats: amount,
              description: 'Payment via AI Assistant'
            },
            confidence: 0.85
          };
        }
      }
      
      if (satoshiMatch || addressMatch) {
        const amount = satoshiMatch ? parseInt(satoshiMatch[1].replace(/,/g, '')) : undefined;
        return {
          needsFunction: true,
          functionName: 'pay_lightning_invoice',
          parameters: {
            invoice_or_address: addressMatch ? addressMatch[0] : '',
            amount_sats: amount,
            description: 'Payment via AI Assistant'
          },
          confidence: 0.9
        };
      }
    }

    // Invoice generation patterns with better matching
    if (/\b(generate|create|make|request)\b.*\b(invoice|bill|payment)\b/i.test(lowerMessage) ||
        /\binvoice\b.*\b(for|of)\b/i.test(lowerMessage)) {
      const satoshiMatch = message.match(/(\d+(?:\,\d+)?)\s*(sats?|satoshis?)/i);
      const descriptionMatch = message.match(/(?:for|description|desc|memo)\s+['""]?([^'""\n]{1,100})['""]?/i);
      
      if (satoshiMatch) {
        const amount = parseInt(satoshiMatch[1].replace(/,/g, ''));
        return {
          needsFunction: true,
          functionName: 'generate_invoice',
          parameters: {
            amount_sats: amount,
            description: descriptionMatch ? descriptionMatch[1].trim() : 'Payment request',
            expiry_seconds: 3600
          },
          confidence: 0.85
        };
      }
    }

    // Merchant search patterns with better categorization
    if (/\b(find|search|show|list|locate)\b/i.test(lowerMessage)) {
      const merchantKeywords = /\b(restaurant|shop|merchant|store|cafe|bar|business|place|establishment)\b/i;
      const locationKeywords = /\b(lugano|ticino|switzerland)\b/i;
      
      if (merchantKeywords.test(lowerMessage) || locationKeywords.test(lowerMessage)) {
        let category = '';
        let query = message;
        
        // Better category detection
        if (/\b(restaurant|dining|food|eat|meal)\b/i.test(lowerMessage)) category = 'restaurant';
        else if (/\b(shop|store|shopping|retail)\b/i.test(lowerMessage)) category = 'storefront';
        else if (/\b(cafe|coffee|espresso|cappuccino)\b/i.test(lowerMessage)) category = 'local_cafe';
        else if (/\b(bar|drink|beer|wine|cocktail)\b/i.test(lowerMessage)) category = 'local_bar';
        
        return {
          needsFunction: true,
          functionName: 'find_merchant_locations',
          parameters: {
            query: query.length < 100 ? query : undefined,
            category: category || undefined,
            limit: 10
          },
          confidence: 0.8
        };
      }
    }

    // Merchant info patterns with better matching
    if (/\b(tell me about|info|information|details|what is)\b/i.test(lowerMessage) ||
        /\bmerchant\s+id\s+\d+\b/i.test(lowerMessage)) {
      const merchantIdMatch = message.match(/\bmerchant\s+id\s+(\d+)\b/i);
      const merchantNameMatch = message.match(/\babout\s+([a-zA-Z\s&'.-]{2,50}?)(?:\s|$|[.!?])/i);
      
      if (merchantIdMatch || merchantNameMatch) {
        return {
          needsFunction: true,
          functionName: 'get_merchant_info',
          parameters: {
            merchant_id: merchantIdMatch ? parseInt(merchantIdMatch[1]) : undefined,
            merchant_name: merchantNameMatch ? merchantNameMatch[1].trim() : undefined
          },
          confidence: 0.75
        };
      }
    }

    return { needsFunction: false, confidence: 0 };
  }

  /**
   * Enhanced message processing with better error handling and response formatting
   */
  async processMessage(message: string, conversationHistory: any[] = []) {
    try {
      console.log('🤖 Processing message:', message);

      // Validate input
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return {
          text: 'Please provide a message for me to process.',
          functionCalled: null,
          functionResult: null
        };
      }

      // Analyze intent
      const intentAnalysis = this.analyzeUserIntent(message);
      console.log('🎯 Intent analysis:', intentAnalysis);

      if (intentAnalysis.needsFunction && intentAnalysis.functionName && intentAnalysis.confidence! > 0.6) {
        // Execute the function
        let functionResult;
        const functionName = intentAnalysis.functionName;
        const functionArgs = intentAnalysis.parameters || {};

        console.log('🔧 Calling function:', functionName, 'with args:', functionArgs);

        // Execute the appropriate function with timeout
        const executeFunction = async () => {
          switch (functionName) {
            case 'pay_lightning_invoice':
              return await this.functions.payLightningInvoice(functionArgs);
            case 'pay_nostr_contact':
              return await this.functions.payNostrContact(functionArgs);
            case 'generate_invoice':
              return await this.functions.generateInvoice(functionArgs);
            case 'find_merchant_locations':
              return await this.functions.findMerchantLocations(functionArgs);
            case 'get_merchant_info':
              return await this.functions.getMerchantInfo(functionArgs);
            default:
              throw new Error('Unknown function');
          }
        };

        // Add timeout to function execution
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Function execution timeout')), 30000)
        );

        try {
          functionResult = await Promise.race([executeFunction(), timeoutPromise]);
        } catch (functionError) {
          console.error('❌ Function execution failed:', functionError);
          functionResult = {
            success: false,
            error: functionError instanceof Error ? functionError.message : 'Function execution failed',
            message: 'I encountered an error while processing your request.'
          };
        }

        console.log('✅ Function result:', functionResult);

        // Generate enhanced AI response
        const systemPrompt = `You are a helpful AI assistant specializing in Bitcoin, Lightning Network, and RGB assets in Lugano, Switzerland.

The user requested: "${message}"

You executed the function "${functionName}" and got this result:
${JSON.stringify(functionResult, null, 2)}

Based on this result, provide a helpful, natural, and engaging response. Guidelines:
- Be conversational and friendly
- Use appropriate emojis (but not excessively)
- If successful, highlight key information and next steps
- If there was an error, explain what went wrong and suggest specific alternatives
- Keep technical details simple and accessible
- For merchant results, highlight the most relevant ones
- For payments, mention security and verification steps
- Always end with an offer to help further

Keep your response concise but informative (max 200 words).`;

        try {
                     const response = await this.premaiClient.chat.completions({
             messages: [
               {
                 role: 'system' as any,
                 content: systemPrompt as any
               },
               {
                 role: 'user' as any,
                 content: message as any
               }
             ],
             model: 'claude-4-sonnet',
             temperature: 0.7
           });

          const aiResponseText = response.choices?.[0]?.message?.content || 
            this.getFallbackResponse(functionResult, functionName);

          return {
            text: aiResponseText,
            functionCalled: functionName,
            functionResult
          };
        } catch (aiError) {
          console.error('❌ AI response generation failed:', aiError);
          return {
            text: this.getFallbackResponse(functionResult, functionName),
            functionCalled: functionName,
            functionResult
          };
        }
      } else {
        // No function needed, use regular AI response
        const systemPrompt = `You are a helpful AI assistant specializing in Bitcoin, Lightning Network, and RGB assets in Lugano, Switzerland. 

You can help users with:
1. 💸 Paying Lightning invoices or Lightning addresses
2. 👥 Paying Nostr contacts by name (if they have Lightning addresses)
3. 🧾 Generating Lightning invoices for receiving payments  
4. 🏪 Finding Bitcoin-accepting merchants in Lugano
5. 📍 Getting detailed information about specific merchants
6. 💡 Answering questions about Bitcoin, Lightning Network, and RGB assets

Provide accurate, helpful information. Be conversational and use emojis appropriately. Keep responses concise but informative. If users want to perform specific actions, guide them on how to ask for what they need.

Examples of what you can help with:
- "Pay 1000 sats to alice@getalby.com"
- "Pay 500 sats to Alice" (if Alice is in your Nostr contacts)
- "Generate invoice for 5000 sats for coffee"
- "Find restaurants in Lugano"
- "Tell me about Bitcoin adoption in Lugano"`;

        try {
                     const response = await this.premaiClient.chat.completions({
             messages: [
               {
                 role: 'system' as any,
                 content: systemPrompt as any
               },
               ...conversationHistory.slice(-10), // Limit history to last 10 messages
               {
                 role: 'user' as any,
                 content: message as any
               }
             ],
             model: 'claude-4-sonnet',
             temperature: 0.7
           });

          const aiResponseText = response.choices?.[0]?.message?.content || 
            'I apologize, but I\'m having trouble generating a response right now. Please try rephrasing your question or ask me about payments, invoices, or merchants in Lugano.';

          return {
            text: aiResponseText,
            functionCalled: null,
            functionResult: null
          };
        } catch (aiError) {
          console.error('❌ AI processing error:', aiError);
          return {
            text: 'I\'m experiencing some technical difficulties. Please try again in a moment. I can help you with Lightning payments, invoice generation, and finding Bitcoin-accepting merchants in Lugano.',
            functionCalled: null,
            functionResult: null
          };
        }
      }
    } catch (error) {
      console.error('❌ Message processing error:', error);
      return {
        text: 'I apologize, but I encountered an unexpected error. Please try again or rephrase your request.',
        functionCalled: null,
        functionResult: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate fallback response when AI response fails
   */
  private getFallbackResponse(functionResult: any, functionName: string): string {
    if (!functionResult) {
      return 'I encountered an issue processing your request. Please try again.';
    }

    if (functionResult.success) {
      switch (functionName) {
        case 'pay_lightning_invoice':
          return `✅ Payment completed successfully! ${functionResult.message || ''}`;
        case 'pay_nostr_contact':
          return `✅ Payment to ${functionResult.contact?.name || 'Nostr contact'} completed successfully! ${functionResult.message || ''}`;
        case 'generate_invoice':
          return `🧾 Invoice generated! Amount: ${functionResult.amount_sats} sats. ${functionResult.message || ''}`;
        case 'find_merchant_locations':
          return `🏪 Found ${functionResult.merchants?.length || 0} merchants in Lugano that accept Bitcoin.`;
        case 'get_merchant_info':
          return `📍 Found merchant: ${functionResult.merchant?.name || 'Unknown'}`;
        default:
          return functionResult.message || 'Request completed successfully!';
      }
    } else {
      return `❌ ${functionResult.message || functionResult.error || 'Something went wrong. Please try again.'}`;
    }
  }
}