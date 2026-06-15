// services/micStream.ts
//
// Raw-PCM microphone streaming for the hands-free voice loop. QVAC's Whisper VAD
// session (`transcribeStream` → `session.write(Uint8Array)`) needs a continuous
// feed of 16 kHz / 16-bit / mono PCM (`s16le`) — but expo-audio's AudioRecorder
// only records to a *file*, so it can't drive the streaming session. This wraps
// `react-native-live-audio-stream`, which emits base64 PCM frames as they're
// captured.
//
// SETUP (required before the hands-free path works on device):
//   expo install react-native-live-audio-stream
//   npx expo prebuild --clean && npx expo run:ios --device   # native module
// It's a native module → needs a dev build (not Expo Go). We `require()` it
// lazily so this file type-checks and the rest of the app builds before the dep
// is installed; `startMicStream` throws a clear error if it's missing.

import { Buffer } from 'buffer';

/** Minimal shape of the `react-native-live-audio-stream` default export. */
interface LiveAudioStreamModule {
  init(opts: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource?: number;
    bufferSize?: number;
    wavFile?: string;
  }): void;
  on(event: 'data', listener: (base64Chunk: string) => void): void;
  start(): void;
  stop(): void;
}

export interface MicStream {
  /** Stop capturing. */
  stop(): void;
}

/** PCM format the QVAC Whisper VAD session expects. */
const PCM_CONFIG = {
  sampleRate: 16000, // Whisper operates at 16 kHz
  channels: 1, // mono
  bitsPerSample: 16, // s16le
  audioSource: 6, // Android MediaRecorder.AudioSource.VOICE_RECOGNITION (ignored on iOS)
  bufferSize: 4096,
} as const;

function loadModule(): LiveAudioStreamModule {
  let mod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('react-native-live-audio-stream');
  } catch {
    throw new Error(
      'react-native-live-audio-stream is not installed — hands-free voice needs it. ' +
        'Run `expo install react-native-live-audio-stream` + a dev build.',
    );
  }
  return (mod?.default ?? mod) as LiveAudioStreamModule;
}

/**
 * Start streaming mic audio. `onChunk` receives 16-bit LE mono PCM frames at
 * 16 kHz — feed them straight to `session.write(...)`. Returns a handle to stop.
 *
 * NOTE: the underlying module registers `data` listeners globally and has no
 * `off()` — so run ONE stream at a time and always `stop()` before starting
 * another (the hands-free controller does this).
 */
export function startMicStream(onChunk: (pcm: Uint8Array) => void): MicStream {
  const LiveAudioStream = loadModule();
  LiveAudioStream.init({ ...PCM_CONFIG });
  LiveAudioStream.on('data', (base64Chunk) => {
    const buf = Buffer.from(base64Chunk, 'base64');
    // View the exact bytes (no copy) as a Uint8Array for session.write().
    onChunk(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  });
  LiveAudioStream.start();
  return {
    stop() {
      try {
        LiveAudioStream.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
