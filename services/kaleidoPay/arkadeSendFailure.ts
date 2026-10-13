/** User-safe diagnostics: never persist arbitrary SDK errors (which can contain payloads). */
export function arkadeSendFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/sub.?dust|dust|minimum|minimal|amount must/i.test(message)) return 'Arkade reported an amount or dust-limit error.';
  if (/insufficient|not enough|cover.*amount/i.test(message)) return 'Arkade reported insufficient spendable funds.';
  if (/rotation cutoff|expired.*signer|signer.*expired/i.test(message)) return 'Arkade reported an expired operator key. The recipient may need a new address.';
  if (/invalid.*address|unknown operator signer/i.test(message)) return 'Arkade could not validate the recipient address.';
  if (/fetch|network|timeout|timed out|connection/i.test(message)) return 'The connection to Arkade was interrupted.';
  if (/vtxo|virtual.*output|coin selection/i.test(message)) return 'Arkade could not use the selected funds. They may need renewal or recovery.';
  return 'Arkade did not return a payment receipt.';
}
