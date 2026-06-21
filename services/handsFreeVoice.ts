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
}

/**
 * Start hands-free voice. Ensures the Whisper model is loaded, opens a VAD
 * session, streams the mic into it (gated during the assistant's own playback),
 * and runs the conversation loop. Returns a controller to stop everything.
 */
export async function startHandsFreeVoice(handlers: HandsFreeHandlers): Promise<HandsFreeController> {
  const qvac = QVACService.getInstance();

  // The session needs the Whisper model resident WITH the Silero VAD submodel
  // (emitVadEvents requires it). initializeWhisper reloads if a prior one-shot
  // load left VAD off; openVoiceSession below also re-checks defensively.
  await qvac.initializeWhisper({ withVad: true });
  if (qvac.getState().whisperStatus !== 'ready') {
    throw new Error(qvac.getState().error || 'voice model failed to load');
  }

  const session = await qvac.openVoiceSession();
  const abort = new AbortController();
  let micGated = false;
  let stopped = false;

  // Drop mic frames while the assistant is speaking so it never hears itself.
  const mic: MicStream = startMicStream((pcm) => {
    if (micGated || stopped) return;
    try {
      session.write(pcm);
    } catch {
      /* session ending — ignore late frames */
    }
  });

  const teardown = () => {
    try {
      mic.stop();
    } catch {
      /* ignore */
    }
    try {
      session.end();
    } catch {
      /* ignore */
    }
  };

  // Fire-and-forget: the loop runs until the session ends or `stop()` aborts it.
  void runVoiceAssistant(
    session,
    {
      respond: handlers.respond,
      speak: handlers.speak,
      setMicGated: (g) => {
        micGated = g;
      },
      onState: handlers.onState,
      onUserText: handlers.onUserText,
    },
    { signal: abort.signal },
  )
    .catch((err) => {
      if (!stopped) handlers.onError?.(err);
    })
    .finally(teardown);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      teardown();
      try {
        session.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
