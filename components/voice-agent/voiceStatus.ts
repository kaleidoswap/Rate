export interface VoiceStatusInput {
  enabled: boolean;
  model: string;
  llmStatus: string;
  whisperStatus: string;
  modelProgress: number;
  speechProgress: number;
  starting: boolean;
  phase: 'idle' | 'listening' | 'thinking' | 'speaking';
  error?: string | null;
}
const progress = (n: number) => Math.round(Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0)));
export function voiceStatus(s: VoiceStatusInput) {
  const ready = s.enabled && s.llmStatus === 'ready' && s.whisperStatus === 'ready';
  const subtitle = !s.enabled ? 'Agent is off' : ready ? `${s.model} · ready on this device` : `${s.model} · not ready`;
  let status: string;
  if (s.phase === 'speaking') status = 'Speaking… tap Pause to stop';
  else if (!s.enabled) status = 'Set up Agent to start a conversation';
  else if (s.error) status = /permission|not-allowed/i.test(s.error) ? 'Allow microphone access in device Settings to talk.' : s.error;
  else if (s.llmStatus === 'error') status = 'AI model unavailable. Tap Prismo to retry.';
  else if (s.whisperStatus === 'error') status = 'Speech recognition unavailable. Tap Prismo to retry.';
  else if (s.llmStatus === 'downloading') status = `Downloading AI model… ${progress(s.modelProgress)}%`;
  else if (s.llmStatus !== 'ready') status = 'Loading AI model…';
  else if (s.whisperStatus === 'downloading') status = `Downloading speech recognition… ${progress(s.speechProgress)}%`;
  else if (s.whisperStatus !== 'ready') status = 'Loading speech recognition…';
  else if (s.starting) status = 'Starting microphone…';
  else if (s.phase === 'listening') status = 'Listening…';
  else if (s.phase === 'thinking') status = 'Preparing a reply…';
  else status = 'Tap Prismo to speak';
  return { subtitle, status, ready };
}
