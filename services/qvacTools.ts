// services/qvacTools.ts
import { z } from 'zod';
import { AIAssistantFunctions } from './aiAssistantFunctions';
import type { QVACTool } from './QVACService';

export function createQVACTools(functions: AIAssistantFunctions): QVACTool[] {
  return [
    {
      name: 'pay_lightning_invoice',
      description:
        'Pay a Lightning Network invoice or send payment to a Lightning address. Use when the user wants to pay, send, or transfer sats.',
      parameters: z.object({
        invoice_or_address: z
          .string()
          .describe('Lightning invoice (lnbc...) or Lightning address (user@domain.com)'),
        amount_sats: z
          .number()
          .optional()
          .describe('Amount in satoshis (required for Lightning addresses)'),
        description: z.string().optional().describe('Optional payment description'),
      }),
      requiresConfirmation: true,
      handler: async (args) => functions.payLightningInvoice(args as any),
    },
    {
      name: 'generate_invoice',
      description:
        'Generate a Lightning Network invoice to receive payment. Use when the user wants to create, generate, or request an invoice.',
      parameters: z.object({
        amount_sats: z.number().describe('Amount in satoshis'),
        description: z.string().optional().describe('Invoice description'),
        expiry_seconds: z.number().optional().describe('Invoice expiry time in seconds (default: 3600)'),
        asset_id: z.string().optional().describe('RGB asset ID for asset payments'),
        asset_amount: z.number().optional().describe('RGB asset amount'),
      }),
      handler: async (args) => functions.generateInvoice(args as any),
    },
    {
      name: 'find_merchant_locations',
      description:
        'Find merchant locations in Lugano that accept Bitcoin payments. Use when the user wants to find, search, or list merchants, restaurants, shops, or businesses.',
      parameters: z.object({
        query: z.string().optional().describe('Search query for merchant name, type, or location'),
        category: z
          .string()
          .optional()
          .describe('Merchant category (restaurant, storefront, local_bar, local_cafe)'),
        near_address: z.string().optional().describe('Find merchants near this address'),
        limit: z.number().optional().default(10).describe('Maximum number of results (1-20)'),
      }),
      handler: async (args) => functions.findMerchantLocations(args as any),
    },
    {
      name: 'get_merchant_info',
      description: 'Get detailed information about a specific merchant by ID or name.',
      parameters: z.object({
        merchant_id: z.number().optional().describe('Merchant ID number'),
        merchant_name: z.string().optional().describe('Merchant name'),
      }),
      handler: async (args) => functions.getMerchantInfo(args as any),
    },
    {
      name: 'pay_nostr_contact',
      description:
        'Pay a Nostr contact by resolving their Lightning address and sending payment. Use when the user wants to pay a friend or contact by name.',
      parameters: z.object({
        contact_name: z.string().optional().describe('Name of the Nostr contact to pay'),
        contact_npub: z.string().optional().describe('Npub of the Nostr contact to pay'),
        amount_sats: z.number().describe('Amount in satoshis to send'),
        description: z.string().optional().describe('Optional payment description'),
      }),
      requiresConfirmation: true,
      handler: async (args) => functions.payNostrContact(args as any),
    },
    {
      name: 'get_wallet_balance',
      description:
        'Get the current wallet balance: spendable Bitcoin (in sats) and any RGB asset balances (e.g. USDT, XAUT). Use when the user asks how much they have, their balance, or funds.',
      parameters: z.object({}),
      handler: async () => functions.getWalletBalance(),
    },
    {
      name: 'get_receive_address',
      description:
        'Get a fresh on-chain Bitcoin address to receive funds. Use when the user wants to deposit, receive on-chain, or asks for their address.',
      parameters: z.object({
        asset_id: z.string().optional().describe('Optional RGB asset ID to associate with the address'),
      }),
      handler: async (args) => functions.getReceiveAddress(args as any),
    },
    {
      name: 'list_recent_transactions',
      description:
        'List the most recent Lightning payments (sent and received). Use when the user asks about history, recent activity, or past payments.',
      parameters: z.object({
        limit: z.number().optional().default(5).describe('How many transactions to return (1-20)'),
      }),
      handler: async (args) => functions.listRecentTransactions(args as any),
    },
  ];
}
