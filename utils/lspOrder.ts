// utils/lspOrder.ts
//
// Maps an LSPS1 channel order (kaleido-sdk `ChannelOrderResponse`) onto the
// `paymentData` shape PaymentConfirmationScreen expects. LSPScreen used to
// pass `{ order }`, which the screen read as `paymentData` → undefined → crash.

export interface LspOrderLike {
  order_id?: string;
  payment?: {
    bolt11?: { invoice?: string; order_total_sat?: number } | null;
  } | null;
}

export interface LspPaymentData {
  type: 'lightning';
  invoice: string;
  /** Satoshis, as a string (PaymentConfirmationScreen formats amounts from sats). */
  amount?: string;
  label: string;
  selectedAsset: { asset_id: string; ticker: string; name: string; isRGB: boolean };
}

export function lspOrderToPaymentData(order: LspOrderLike | null | undefined): LspPaymentData | null {
  const bolt11 = order?.payment?.bolt11;
  if (!bolt11?.invoice) return null;
  const total = Number(bolt11.order_total_sat);
  return {
    type: 'lightning',
    invoice: bolt11.invoice,
    amount: Number.isFinite(total) && total > 0 ? String(total) : undefined,
    label: order?.order_id ? `Channel order ${order.order_id}` : 'Channel order',
    selectedAsset: { asset_id: 'BTC', ticker: 'BTC', name: 'Bitcoin', isRGB: false },
  };
}
