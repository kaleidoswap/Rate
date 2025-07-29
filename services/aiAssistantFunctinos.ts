// aiAssistantFunctions.ts
import { RGBApiService } from '../services/RGBApiService';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Add your OpenAI API key
});

// Location data from Lugano merchants
const LUGANO_MERCHANTS = [
  // Your merchant data here - imported from lugano-merchants.json
];

// Function definitions for the AI assistant
export const AI_FUNCTIONS = [
  {
    name: 'pay_lightning_invoice',
    description: 'Pay a Lightning Network invoice or send payment to a Lightning address',
    parameters: {
      type: 'object',
      properties: {
        invoice_or_address: {
          type: 'string',
          description: 'Lightning invoice (lnbc...) or Lightning address (user@domain.com)'
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
        
        // Convert Lightning address to invoice
        const [username, domain] = invoice_or_address.split('@');
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
        
        invoice_or_address = invoiceData.pr; // Use the generated invoice
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
 * Enhanced AI Assistant with Function Calling
 */
export class EnhancedAIAssistant {
  private functions: AIAssistantFunctions;
  private openai: OpenAI;

  constructor() {
    this.functions = new AIAssistantFunctions();
    this.openai = openai;
  }

  /**
   * Process user message with function calling capabilities
   */
  async processMessage(message: string, conversationHistory: any[] = []) {
    try {
      const messages = [
        {
          role: 'system' as const,
          content: `You are a helpful AI assistant specializing in Bitcoin, Lightning Network, and RGB assets. You can help users with:

1. Paying Lightning invoices or Lightning addresses
2. Generating Lightning invoices for receiving payments
3. Finding Bitcoin-accepting merchants in Lugano, Switzerland
4. Providing information about specific merchants

You have access to function calling capabilities. When users want to:
- Pay someone: Use pay_lightning_invoice function
- Create an invoice: Use generate_invoice function  
- Find places to spend Bitcoin: Use find_merchant_locations function
- Get info about a specific merchant: Use get_merchant_info function

Always provide helpful context and explanations with your responses. Be concise but informative.`
        },
        ...conversationHistory,
        {
          role: 'user' as const,
          content: message
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages,
        functions: AI_FUNCTIONS,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 1000
      });

      const assistantMessage = response.choices[0].message;

      // Check if the assistant wants to call a function
      if (assistantMessage.function_call) {
        const functionName = assistantMessage.function_call.name;
        const functionArgs = JSON.parse(assistantMessage.function_call.arguments || '{}');

        let functionResult;

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

        // Get the final response from the assistant with function result
        const finalResponse = await this.openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            ...messages,
            assistantMessage,
            {
              role: 'function' as const,
              name: functionName,
              content: JSON.stringify(functionResult)
            }
          ],
          temperature: 0.7,
          max_tokens: 1000
        });

        return {
          text: finalResponse.choices[0].message.content || 'I apologize, but I encountered an issue processing your request.',
          functionCalled: functionName,
          functionResult
        };
      }

      return {
        text: assistantMessage.content || 'I apologize, but I couldn\'t generate a response.',
        functionCalled: null,
        functionResult: null
      };
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

// Usage example:
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
*/