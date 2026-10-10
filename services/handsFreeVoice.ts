// services/handsFreeVoice.ts
//
// Ties the three pieces of hands-free voice together:
//   QVACService.openVoiceSession()  — the Whisper VAD conversation session
//   startMicStream()                — raw PCM frames fed to session.write()
//   runVoiceAssistant()             — the transcribe → reason → speak loop
//                                     (mic-gate during playback) from the shared
//                                     @kaleidorg/mind/qvac package
//
// The caller (VoiceAgentOverlay) supplies `respond` (run a KaleidoMind turn →
// reply text) and `speak` (synthesize + play). This file owns the wiring +
// teardown; it has no React dependency so the loop logic stays testable.
//
// Requires @qvac/sdk ≥ 0.13.1 (the VAD conversation session) + a dev build with
// react-native-live-audio-stream. See micStream.ts for setup.

import { runVoiceAssistant, type VoiceAssistantState } from '@kaleidorg/mind/qvac';
import QVACService from './QVACService';
import { startMicStream, type MicStream } from './micStream';
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

export interface HandsFreeHandlers {
  /** Run a turn for a user utterance and return the assistant's reply text. */
  respond: (transcript: string) => Promise<string>;
  /** Speak the reply; resolve when playback finishes. */
  speak: (text: string) => Promise<void>;
  /** UI state transitions (listening → thinking → speaking → listening). */
  onState?: (state: VoiceAssistantState) => void;
  /** A user utterance passed the filter and is being handled. */
  onUserText?: (text: string) => void;
  /** The loop ended unexpectedly (mic/session error). */
  onError?: (err: unknown) => void;
}

export interface HandsFreeController {
  /** Stop the loop, the mic, and tear down the session. Idempotent. */
  stop(): void;
  /** Drop mic input while true (e.g. while a confirm sheet is open). */
  setPaused(paused: boolean): void;
}

/**
 * Start hands-free voice. Ensures the Whisper model is loaded, opens a VAD
 * session, streams the mic into it (gated during the assistant's own playback),
 * and runs the conversation loop. Returns a controller to stop everything.
 */
export async function startHandsFreeVoice(handlers: HandsFreeHandlers, signal?: AbortSignal): Promise<HandsFreeController> {
  const checkCancelled = () => {
    if (signal?.aborted) { const error = new Error('Voice start cancelled'); error.name = 'AbortError'; throw error; }
  };
  checkCancelled();
  const qvac = QVACService.getInstance();
  await qvac.initializeWhisper({ withVad: true });
  checkCancelled();
  if (qvac.getState().whisperStatus !== 'ready') throw new Error(qvac.getState().error || 'Voice model unavailable');
  const permission = await requestRecordingPermissionsAsync();
  checkCancelled();
  if (!permission.granted) throw new Error('Microphone permission denied');
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  checkCancelled();
  const session = await qvac.openVoiceSession();
  const abort = new AbortController();
  let mic: MicStream | undefined;
  let micGated = false, paused = false, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', stop);
    abort.abort();
    try { mic?.stop(); } catch {}
    try { session.end(); } catch {}
    try { session.destroy(); } catch {}
  };
  // Cancellation can arrive while native session creation is awaiting completion.
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) { stop(); checkCancelled(); }
  try {
    mic = startMicStream(pcm => {
      if (micGated || paused || stopped) return;
      try { session.write(pcm); } catch {}
    });
    void runVoiceAssistant(session, {
      respond: text => stopped ? Promise.resolve('') : handlers.respond(text),
      speak: text => stopped ? Promise.resolve() : handlers.speak(text),
      setMicGated: gated => { micGated = gated; },
      onState: state => { if (!stopped) handlers.onState?.(state); },
      onUserText: text => { if (!stopped) handlers.onUserText?.(text); },
    }, { signal: abort.signal }).catch(error => {
      if (!stopped) handlers.onError?.(error);
    }).finally(stop);
  } catch (error) { stop(); throw error; }
  return { stop, setPaused: value => { paused = value; } };
}
