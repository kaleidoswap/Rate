import type { RgbReceivedMint } from '@utexo/webrgb';
import type { RgbLibRnAccount } from '../protocols/rgbLibRn';

type MintAccount = Pick<RgbLibRnAccount, 'network' | 'supportsReceivedMint' | 'getReceivedMintForInvoice'>;

export function supportsReceivedMint(account: MintAccount): boolean {
  return account.supportsReceivedMint?.() === true && typeof account.getReceivedMintForInvoice === 'function';
}

function hex32(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function positiveU64(value: unknown): boolean {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
}

export async function getReceivedMint(account: MintAccount, invoice: string, guard: () => void): Promise<RgbReceivedMint | null> {
  guard();
  if (!supportsReceivedMint(account)) {
    throw Object.assign(new Error('This native wallet cannot verify a received mint.'), { code: 'METHOD_NOT_SUPPORTED' });
  }
  // Native rgb-lib validates the consignment and binds its transfer to the full invoice.
  const result = await account.getReceivedMintForInvoice(invoice, guard);
  guard();
  if (result === null) return null;
  if (!result || result.invoice !== invoice || result.network !== account.network ||
      typeof result.recipientId !== 'string' || !result.recipientId || result.recipientId.length > 1024 ||
      typeof result.assetId !== 'string' || !/^rgb:\S{1,508}$/.test(result.assetId) ||
      !hex32(result.opid) || !hex32(result.lockId) || (result.txid !== undefined && !hex32(result.txid)) ||
      !positiveU64(result.amount) || !positiveU64(result.beforeBlock) || !positiveU64(result.evmChainId) ||
      typeof result.bridgeContract !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(result.bridgeContract)) {
    throw Object.assign(new Error('The wallet returned an invalid mint commitment.'), { code: 'INTERNAL_ERROR' });
  }
  const { recipientId, assetId, network, txid, opid, lockId, amount, beforeBlock, evmChainId, bridgeContract } = result;
  return { invoice, recipientId, assetId, network, ...(txid ? { txid } : {}), opid, lockId, amount, beforeBlock, evmChainId, bridgeContract: bridgeContract.toLowerCase() };
}
