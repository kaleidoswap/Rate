import AsyncStorage from '@react-native-async-storage/async-storage';

const messages = {
  amount: 'Arkade reported an amount or dust-limit error.',
  insufficient: 'Arkade reported insufficient spendable funds.',
  signer: 'Arkade reported an expired operator key.',
  address: 'Arkade could not validate the recipient address.',
  connection: 'The connection to Arkade was interrupted.',
  spent: 'Arkade reported that an input was already spent or reserved.',
  annotation: 'Arkade could not resolve the signing data for an input.',
  inputs: 'Arkade could not prepare the selected funds.',
  unknown: 'Arkade did not return a payment receipt.',
} as const;
export type ArkadeFailureCode = keyof typeof messages;
/** Only a fixed category leaves the SDK error boundary. Never save raw messages/payloads. */
export function arkadeFailureCode(error: unknown): ArkadeFailureCode {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : '';
  if (/sub.?dust|dust|minimum|minimal|amount must/i.test(message)) return 'amount';
  if (/insufficient|not enough|cover.*amount/i.test(message)) return 'insufficient';
  if (/rotation cutoff|expired.*signer|signer.*expired/i.test(message)) return 'signer';
  if (/invalid.*address|unknown operator signer/i.test(message)) return 'address';
  if (/fetch|network|timeout|timed out|connection/i.test(message)) return 'connection';
  if (/already spent|already.*registered|reserved|input.*locked|vtxo.*spent/i.test(message)) return 'spent';
  if (/annotation|signing descriptor|UnannotatableInput|MissingSigningDescriptor/i.test(message)) return 'annotation';
  if (/vtxo|virtual.*output|coin selection/i.test(message)) return 'inputs';
  return 'unknown';
}
export const arkadeSendFailure = (error: unknown): string => messages[arkadeFailureCode(error)];
const key = (attemptId: string) => `arkade-send-diagnostic:${attemptId}`;
export async function recordArkadeSendFailure(attemptId: string, error: unknown): Promise<void> {
  await AsyncStorage.setItem(key(attemptId), JSON.stringify({ code: arkadeFailureCode(error), stage: 'send', recordedAt: Date.now() }));
}
export async function readArkadeSendFailure(attemptId: string): Promise<{ code: ArkadeFailureCode; stage: 'send'; recordedAt: number } | undefined> {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(key(attemptId)) || 'null');
    if (!value || !Object.prototype.hasOwnProperty.call(messages, value.code) || value.stage !== 'send' || !Number.isSafeInteger(value.recordedAt)) return undefined;
    return { code: value.code, stage: 'send', recordedAt: value.recordedAt };
  } catch { return undefined; }
}
