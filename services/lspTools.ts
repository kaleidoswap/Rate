// Mobile binding for the canonical @kaleidorg/mind LSPS1 contract.
//
// Registers the lsp_* tools (get info, network info, estimate fees, create
// order, get order) bound to rate's ON-DEVICE RGB Lightning node via the maker
// LSP — no MCP, no P2P delegation. `lsp_create_order` is a spend →
// confirmation-gated by the contract. The execute path mirrors the tested
// LSPScreen flow (executeProtocolOperation('createLspOrder', …)).

import { bindLsps1Tools, type ToolSource } from '@kaleidorg/mind';
import { protocolManager, kaleidoClientManager } from './protocols';

const log = (...a: any[]) => { try { console.log('[AI/lsp]', ...a); } catch { /* noop */ } };

function rgbAdapter(): any {
  const a = protocolManager.getAdapterIfAvailable('RGB');
  if (!a?.isConnected()) {
    throw new Error('Connect your RGB Lightning wallet to buy inbound channels.');
  }
  return a;
}
function maker(): any { return kaleidoClientManager.getClient().maker; }

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  lsp_get_info: async () => rgbAdapter().executeProtocolOperation('getLspInfo', {}),

  lsp_get_network_info: async () => {
    rgbAdapter();
    return maker().getLspNetworkInfo();
  },

  lsp_estimate_fees: async ({ lsp_balance_sat, client_balance_sat, channel_expiry_blocks }) => {
    const a = rgbAdapter();
    const nodeInfo: any = await a.getNodeInfo();
    const params: Record<string, unknown> = {
      client_pubkey: nodeInfo?.pubkey,
      lsp_balance_sat: Number(lsp_balance_sat),
      client_balance_sat: client_balance_sat != null ? Number(client_balance_sat) : 0,
    };
    if (channel_expiry_blocks != null) params.channel_expiry_blocks = Number(channel_expiry_blocks);
    return a.executeProtocolOperation('estimateLspFees', params);
  },

  // SPEND (confirmation-gated by the contract). Assembles the full order
  // payload from the user's node + the LSP's advertised options, mirroring the
  // tested LSPScreen flow. Returns the order id + the invoice to pay.
  lsp_create_order: async ({ lsp_balance_sat, client_balance_sat, channel_expiry_blocks, refund_onchain_address }) => {
    const a = rgbAdapter();
    const [nodeInfo, lspInfo] = await Promise.all([
      a.getNodeInfo(),
      a.executeProtocolOperation('getLspInfo', {}),
    ]);
    const opts: any = (lspInfo as any)?.options ?? {};
    const refund = refund_onchain_address
      ? String(refund_onchain_address)
      : (await a.getReceiveAddress())?.address;
    if (!refund) throw new Error('Could not derive an on-chain refund address for the channel order.');

    const expiry = channel_expiry_blocks != null
      ? Number(channel_expiry_blocks)
      : (opts.min_channel_expiry_blocks ?? opts.max_channel_expiry_blocks ?? 4320);

    const payload = {
      announce_channel: false, // private channel — a personal mobile wallet
      channel_expiry_blocks: expiry,
      client_balance_sat: client_balance_sat != null ? Number(client_balance_sat) : 0,
      client_pubkey: (nodeInfo as any)?.pubkey,
      funding_confirms_within_blocks: opts.min_funding_confirms_within_blocks ?? 1,
      lsp_balance_sat: Number(lsp_balance_sat),
      refund_onchain_address: refund,
      required_channel_confirmations: opts.min_required_channel_confirmations ?? 3,
    };
    log('create order', { lsp_balance_sat: payload.lsp_balance_sat, expiry });
    return a.executeProtocolOperation('createLspOrder', payload);
  },

  lsp_get_order: async ({ order_id }) =>
    rgbAdapter().executeProtocolOperation('getLspOrder', { order_id: String(order_id) }),
};

/** Build the on-device LSPS1 (channel orders) tool source. */
export function buildLspToolSource(): ToolSource {
  return bindLsps1Tools(HANDLERS);
}
