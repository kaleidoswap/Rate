import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

const events: Array<{ at: string; stage: string; detail: string }> = [];
// Bounded diagnostic buffer; strip utterances, URLs and long identifiers from errors.
export function recordVoiceDiagnostic(stage: string, detail = ''): void {
  events.push({ at: new Date().toISOString(), stage, detail: detail.slice(0, 240) });
  if (events.length > 150) events.shift();
}
export function diagnosticError(message: string, utterances: string[]): string {
  let safe = message;
  for (const text of utterances) if (text) safe = safe.split(text).join('[speech omitted]');
  if (/prompt|transcript|history|inputText|\btext\s*[:=]/i.test(safe)) return '[content-bearing log omitted]';
  return safe.replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/(?:\/Users\/|\/var\/|file:\/\/)[^\s]+/g, '[path]')
    .replace(/[a-zA-Z0-9_+\/=-]{40,}/g, '[identifier]').slice(0, 220);
}
export function voiceDiagnosticReport(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(), platform: Platform.OS, os: Platform.Version,
    app: DeviceInfo.getVersion?.(), build: DeviceInfo.getBuildNumber?.(),
    device: DeviceInfo.getModel?.(), model: 'Supertonic 3 Q8_0', voice: 'F1',
    events,
  }, null, 2);
}
export type VoiceStage = 'loading' | 'generating';

/** Bound the wait and cancel the exact native request, including on user stop. */
export async function waitForVoice<T>(promise: Promise<T>, requestId: string | undefined,
  signal: AbortSignal | undefined, ms: number, stage: VoiceStage,
  cancel: (id: string) => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const stop = (timeout: boolean) => {
      recordVoiceDiagnostic(timeout ? 'timeout' : 'cancelled', stage);
      if (requestId) void cancel(requestId).catch(() => recordVoiceDiagnostic('cancel_failed', stage));
      reject(new Error(timeout ? `Supertonic ${stage} timed out. Please retry.` : 'Voice cancelled'));
    };
    abort = () => stop(false);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop(true), ms);
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
