// aiAssistantFunctions.ts
import { RGBApiService } from '../services/RGBApiService';
import PremAI from 'premai';
import { LightningAddress, Invoice } from '@getalby/lightning-tools';

// Initialize PremAI client
const premaiClient = new PremAI({
  apiKey: 'premKey_s1rKUkWbb0JbVRUU12U6y6bnUZJjaNZa7a3z', // Your existing PremAI key
});

// Location data from Lugano merchants
import LUGANO_MERCHANTS_DATA from '../assets/lugano-merchants.json';
const LUGANO_MERCHANTS = LUGANO_MERCHANTS_DATA;

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
          description: 'Amount in satoshis (required for Lightning addresses)'
        },
        description: {
          type: 'string',
          description: 'Optional payment description'
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
          description: 'Amount in satoshis'
        },
        description: {
          type: 'string',
          description: 'Invoice description'
        },
        expiry_seconds: {
          type: 'number',
          description: 'Invoice expiry time in seconds (default: 3600)'
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
    description: 'Find merchant locations in Lugano that accept Bitcoin payments',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for merchant name, type, or location'
        },
        category: {
          type: 'string',
          description: 'Merchant category (restaurant, storefront, local_bar, etc.)'
        },
        near_address: {
          type: 'string',
          description: 'Find merchants near this address'
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
          description: 'Merchant name'
        }
      }
    }
  }
];

// Function implementations
export class AIAssistantFunctions {
  private rgbApi: RGBApiService;

  constructor() {
    this.rgbApi = RGBApiService.getInstance();
  }

  /**
   * Pay a Lightning invoice or send to Lightning address
   */
  async payLightningInvoice({
    invoice_or_address,
    amount_sats,
    description
  }: {
    invoice_or_address: string;
    amount_sats?: number;
    description?: string;
  }) {
    try {
      // Check if it's a Lightning address (contains @)
      if (invoice_or_address.includes('@')) {
        if (!amount_sats) {
          throw new Error('Amount is required for Lightning address payments');
        }
        
        // Use Alby lightning tools to handle Lightning address
        try {
          const lightningAddress = new LightningAddress(invoice_or_address);
          
          // Fetch Lightning address data
          await lightningAddress.fetch();
          
          // Request invoice with amount and comment
          const invoiceResponse = await lightningAddress.requestInvoice({
            satoshi: amount_sats,
            comment: description || ''
          });
          
          invoice_or_address = invoiceResponse.paymentRequest;
        } catch (albyError) {
          console.warn('Alby lightning tools failed, using fallback:', albyError);
          // Fallback to manual implementation
          invoice_or_address = await this.resolveLightningAddressManual(
            invoice_or_address, 
            amount_sats, 
            description
          );
        }
      }

      // Pay the invoice using RGB Lightning Node
      const result = await this.rgbApi.payLightningInvoice({
        invoice: invoice_or_address
      });

      return {
        success: true,
        payment_hash: result.payment_hash,
        status: result.status,
        message: `Payment ${result.status.toLowerCase()}! Payment hash: ${result.payment_hash}`
      };
    } catch (error) {
      console.error('Payment error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment failed',
        message: `Payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validate a Lightning address format
   */
  isValidLightningAddress(address: string): boolean {
    // Basic validation for Lightning address format
    return address.includes('@') && address.split('@').length === 2;
  }

  /**
   * Get invoice information using Alby tools
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
        isExpired: invoice.expiryDate && new Date() > invoice.expiryDate
      };
    } catch (error) {
      console.error('Error parsing invoice:', error);
      throw new Error('Invalid payment request');
    }
  }

  /**
   * Check if a Lightning address is valid and reachable
   */
  async validateLightningAddress(address: string): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.isValidLightningAddress(address)) {
        return { valid: false, error: 'Invalid Lightning address format' };
      }

      const lightningAddress = new LightningAddress(address);
      await lightningAddress.fetch();
      
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Lightning address validation failed' 
      };
    }
  }

  /**
   * Manual Lightning address resolution fallback
   */
  private async resolveLightningAddressManual(
    lightningAddress: string,
    amount_sats: number,
    description?: string
  ): Promise<string> {
    const [username, domain] = lightningAddress.split('@');
    const lnurlResponse = await fetch(`https://${domain}/.well-known/lnurlp/${username}`);
    
    if (!lnurlResponse.ok) {
      throw new Error('Failed to resolve Lightning address');
    }
    
    const lnurlData = await lnurlResponse.json();
    
    // Request invoice from LNURL endpoint
    const invoiceResponse = await fetch(lnurlData.callback + 
      `?amount=${amount_sats * 1000}&comment=${encodeURIComponent(description || '')}`);
    
    if (!invoiceResponse.ok) {
      throw new Error('Failed to get invoice from Lightning address');
    }
    
    const invoiceData = await invoiceResponse.json();
    
    if (invoiceData.status === 'ERROR') {
      throw new Error(invoiceData.reason || 'Failed to generate invoice');
    }
    
    return invoiceData.pr;
  }

  /**
   * Generate a Lightning Network invoice
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

      return {
        success: true,
        invoice: result.invoice,
        payment_hash: result.payment_hash,
        amount_sats,
        description,
        expiry_seconds,
        message: `Invoice generated successfully! Amount: ${amount_sats} sats`
      };
    } catch (error) {
      console.error('Invoice generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invoice generation failed',
        message: `Failed to generate invoice: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Find merchant locations in Lugano
   */
  async findMerchantLocations({
    query,
    category,
    near_address
  }: {
    query?: string;
    category?: string;
    near_address?: string;
  } = {}) {
    try {
      let filteredMerchants = LUGANO_MERCHANTS;

      // Filter by category
      if (category) {
        filteredMerchants = filteredMerchants.filter(merchant => 
          merchant.icon === category || 
          merchant.name.toLowerCase().includes(category.toLowerCase())
        );
      }

      // Filter by search query
      if (query) {
        const searchTerm = query.toLowerCase();
        filteredMerchants = filteredMerchants.filter(merchant =>
          merchant.name.toLowerCase().includes(searchTerm) ||
          merchant.address.toLowerCase().includes(searchTerm) ||
          (merchant.website && merchant.website.toLowerCase().includes(searchTerm))
        );
      }

      // Limit results to avoid overwhelming the user
      const results = filteredMerchants.slice(0, 10);

      return {
        success: true,
        merchants: results.map(merchant => ({
          id: merchant.id,
          name: merchant.name,
          address: merchant.address,
          category: merchant.icon,
          phone: merchant.phone,
          website: merchant.website,
          opening_hours: merchant.opening_hours
        })),
        total_found: filteredMerchants.length,
        message: `Found ${results.length} merchants${query ? ` matching "${query}"` : ''}${category ? ` in category "${category}"` : ''}`
      };
    } catch (error) {
      console.error('Merchant search error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        message: 'Failed to search merchants'
      };
    }
  }

  /**
   * Get detailed merchant information
   */
  async getMerchantInfo({
    merchant_id,
    merchant_name
  }: {
    merchant_id?: number;
    merchant_name?: string;
  }) {
    try {
      let merchant;

      if (merchant_id) {
        merchant = LUGANO_MERCHANTS.find(m => m.id === merchant_id);
      } else if (merchant_name) {
        merchant = LUGANO_MERCHANTS.find(m => 
          m.name.toLowerCase().includes(merchant_name.toLowerCase())
        );
      }

      if (!merchant) {
        return {
          success: false,
          error: 'Merchant not found',
          message: 'Could not find the requested merchant'
        };
      }

      return {
        success: true,
        merchant: {
          id: merchant.id,
          name: merchant.name,
          address: merchant.address,
          category: merchant.icon,
          phone: merchant.phone,
          website: merchant.website,
          opening_hours: merchant.opening_hours
        },
        message: `Found merchant: ${merchant.name}`
      };
    } catch (error) {
      console.error('Merchant info error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get merchant info',
        message: 'Failed to retrieve merchant information'
      };
    }
  }
}

/**
 * Enhanced AI Assistant with Function Calling using PremAI
 */
export class EnhancedAIAssistant {
  private functions: AIAssistantFunctions;
  private premaiClient: PremAI;

  constructor() {
    this.functions = new AIAssistantFunctions();
    this.premaiClient = premaiClient;
  }

  /**
   * Analyze user message to determine if function calling is needed
   */
  private analyzeUserIntent(message: string): {
    needsFunction: boolean;
    functionName?: string;
    parameters?: any;
  } {
    const lowerMessage = message.toLowerCase();

    // Payment patterns
    if (lowerMessage.includes('pay') || lowerMessage.includes('send')) {
      const satoshiMatch = message.match(/(\d+)\s*(sats?|satoshis?)/i);
      const addressMatch = message.match(/([a-zA-Z0-9]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|((lnbc|lntb)[a-zA-Z0-9]+)/i);
      
      if (satoshiMatch || addressMatch) {
        return {
          needsFunction: true,
          functionName: 'pay_lightning_invoice',
          parameters: {
            invoice_or_address: addressMatch ? addressMatch[0] : '',
            amount_sats: satoshiMatch ? parseInt(satoshiMatch[1]) : undefined,
            description: 'Payment via AI Assistant'
          }
        };
      }
    }

    // Invoice generation patterns
    if (lowerMessage.includes('generate') && lowerMessage.includes('invoice') || 
        lowerMessage.includes('create') && lowerMessage.includes('invoice')) {
      const satoshiMatch = message.match(/(\d+)\s*(sats?|satoshis?)/i);
      const descriptionMatch = message.match(/(?:for|description|desc)\s+['""]?([^'""\n]+)['""]?/i);
      
      if (satoshiMatch) {
        return {
          needsFunction: true,
          functionName: 'generate_invoice',
          parameters: {
            amount_sats: parseInt(satoshiMatch[1]),
            description: descriptionMatch ? descriptionMatch[1].trim() : 'Payment request',
            expiry_seconds: 3600
          }
        };
      }
    }

    // Merchant search patterns
    if (lowerMessage.includes('find') || lowerMessage.includes('search') || lowerMessage.includes('show')) {
      if (lowerMessage.includes('restaurant') || lowerMessage.includes('shop') || 
          lowerMessage.includes('merchant') || lowerMessage.includes('store') ||
          lowerMessage.includes('cafe') || lowerMessage.includes('bar') ||
          lowerMessage.includes('lugano')) {
        
        let category = '';
        if (lowerMessage.includes('restaurant')) category = 'restaurant';
        else if (lowerMessage.includes('shop') || lowerMessage.includes('store')) category = 'storefront';
        else if (lowerMessage.includes('cafe') || lowerMessage.includes('coffee')) category = 'local_cafe';
        else if (lowerMessage.includes('bar')) category = 'local_bar';
        
        return {
          needsFunction: true,
          functionName: 'find_merchant_locations',
          parameters: {
            query: message,
            category: category || undefined
          }
        };
      }
    }

    // Merchant info patterns
    if (lowerMessage.includes('tell me about') || lowerMessage.includes('info') || 
        lowerMessage.includes('details') || lowerMessage.includes('merchant id')) {
      const merchantIdMatch = message.match(/merchant\s+id\s+(\d+)/i);
      const merchantNameMatch = message.match(/about\s+([a-zA-Z\s&'.-]+?)(?:\s|$)/i);
      
      if (merchantIdMatch || merchantNameMatch) {
        return {
          needsFunction: true,
          functionName: 'get_merchant_info',
          parameters: {
            merchant_id: merchantIdMatch ? parseInt(merchantIdMatch[1]) : undefined,
            merchant_name: merchantNameMatch ? merchantNameMatch[1].trim() : undefined
          }
        };
      }
    }

    return { needsFunction: false };
  }

  /**
   * Process user message with function calling capabilities using PremAI
   */
  async processMessage(message: string, conversationHistory: any[] = []) {
    try {
      // First, analyze if we need to call a function
      const intentAnalysis = this.analyzeUserIntent(message);

      if (intentAnalysis.needsFunction && intentAnalysis.functionName) {
        // Execute the function first
        let functionResult;
        const functionName = intentAnalysis.functionName;
        const functionArgs = intentAnalysis.parameters || {};

        console.log('🔧 Calling function:', functionName, 'with args:', functionArgs);

        // Execute the appropriate function
        switch (functionName) {
          case 'pay_lightning_invoice':
            functionResult = await this.functions.payLightningInvoice(functionArgs);
            break;
          case 'generate_invoice':
            functionResult = await this.functions.generateInvoice(functionArgs);
            break;
          case 'find_merchant_locations':
            functionResult = await this.functions.findMerchantLocations(functionArgs);
            break;
          case 'get_merchant_info':
            functionResult = await this.functions.getMerchantInfo(functionArgs);
            break;
          default:
            functionResult = { error: 'Unknown function' };
        }

        console.log('✅ Function result:', functionResult);

        // Now generate a natural language response based on the function result
        const systemPrompt = `You are a helpful AI assistant specializing in Bitcoin, Lightning Network, and RGB assets. 

The user requested: "${message}"

You executed the function "${functionName}" and got this result:
${JSON.stringify(functionResult, null, 2)}

Based on this result, provide a helpful, natural response to the user. If the function was successful, explain what happened and any next steps. If there was an error, explain what went wrong and suggest alternatives.

Keep your response conversational and helpful, using emojis when appropriate.`;

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
        });

        const aiResponseText = response.choices?.[0]?.message?.content || 
          (functionResult.success ? functionResult.message : `Function completed: ${functionResult.error || 'Unknown result'}`);

        return {
          text: aiResponseText,
          functionCalled: functionName,
          functionResult
        };
      } else {
        // No function needed, use regular AI response
        const systemPrompt = `You are a helpful AI assistant specializing in Bitcoin, Lightning Network, and RGB assets. You can help users with:

1. Paying Lightning invoices or Lightning addresses (just ask me to pay someone)
2. Generating Lightning invoices for receiving payments (ask me to generate an invoice)
3. Finding Bitcoin-accepting merchants in Lugano, Switzerland (ask me to find restaurants, shops, etc.)
4. Providing information about specific merchants (ask about a specific merchant)

Provide accurate, helpful information about cryptocurrency, blockchain technology, and digital assets. Keep responses concise but informative. Use emojis occasionally to make responses more engaging.

If the user wants to do payments, generate invoices, or find merchants, let them know I can help with that specifically.`;

        const response = await this.premaiClient.chat.completions({
          messages: [
            {
              role: 'system' as any,
              content: systemPrompt as any
            },
            ...conversationHistory,
            {
              role: 'user' as any,
              content: message as any
            }
          ],
          model: 'claude-4-sonnet',
        });

        const aiResponseText = response.choices?.[0]?.message?.content || 
          'Sorry, I couldn\'t generate a response. Please try again.';

        return {
          text: aiResponseText,
          functionCalled: null,
          functionResult: null
        };
      }
    } catch (error) {
      console.error('AI processing error:', error);
      return {
        text: 'I apologize, but I encountered an error processing your request. Please try again.',
        functionCalled: null,
        functionResult: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Usage example with PremAI:
/*
const aiAssistant = new EnhancedAIAssistant();

// Example usage
const response = await aiAssistant.processMessage(
  "Pay 1000 sats to alice@example.com for coffee"
);

const invoiceResponse = await aiAssistant.processMessage(
  "Generate an invoice for 5000 sats for selling a book"
);

const merchantResponse = await aiAssistant.processMessage(
  "Find restaurants in Lugano that accept Bitcoin"
);

// The system will automatically detect intent and call appropriate functions
// without needing OpenAI's function calling feature - using pattern matching instead
*/