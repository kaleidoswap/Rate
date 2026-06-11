// components/VoiceInput.tsx
import React, { useRef, useImperativeHandle, forwardRef, useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  AudioModule,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  IOSOutputFormat,
  AudioQuality,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import QVACService from '../services/QVACService';

// 16 kHz mono 16-bit PCM WAV — the format Whisper expects. iOS records LINEARPCM
// directly; Android records its default encoder into a .wav container. Channel
// count and bit rate are top-level in expo-audio's RecordingOptions; the per-OS
// blocks carry only the format/codec specifics.
const RECORDING_OPTIONS: RecordingOptions = {
  isMeteringEnabled: false,
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: {
    extension: '.wav',
    outputFormat: 'default',
    audioEncoder: 'default',
    sampleRate: 16000,
  },
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

// Stop (if recording) and free the native recorder. expo-audio splits what
// expo-av's stopAndUnloadAsync() did into stop() + release(); never throws.
async function disposeRecorder(rec: AudioRecorder): Promise<void> {
  try { await rec.stop(); } catch { /* not recording / already stopped */ }
  try { rec.release(); } catch { /* already released */ }
}

// We serialise recording to ONE AudioRecorder at a time. Multiple VoiceInput
// instances can be mounted simultaneously on the tab navigator (the AI chat
// screen's mic + the dashboard voice-agent overlay), and they share the single
// hardware microphone — without coordination a second instance starts capturing
// while the first still holds the mic. This module-level handle is the shared
// source of truth so any instance can release it (on stop, error, or unmount).
let activeRecording: AudioRecorder | null = null;
// Synchronous reservation so two instances starting in the same tick can't both
// pass the activeRecording check (there are awaits before it's assigned) and
// race into prepareToRecordAsync. Set before the first await, cleared in finally.
let recorderStarting = false;

interface VoiceInputProps {
  onResult: (text: string) => void;
  onPartialResult: (text: string) => void;
  onError: (error: string) => void;
  onStart: () => void;
  onEnd: () => void;
}

export interface VoiceInputRef {
  startListening: () => void;
  stopListening: () => void;
}

const VoiceInput = forwardRef<VoiceInputRef, VoiceInputProps>(
  ({ onResult, onPartialResult, onError, onStart, onEnd }, ref) => {
    const recorderRef = useRef<AudioRecorder | null>(null);
    const startingRef = useRef(false);
    const isRecordingRef = useRef(false);
    const [isRecording, setIsRecording] = useState(false);

    useImperativeHandle(ref, () => ({
      startListening: () => startRecording(),
      stopListening: () => stopRecording(),
    }));

    // Release the app-wide native recorder if this instance still owns it when it
    // unmounts (e.g. the voice-agent overlay closes mid-recording). Otherwise the
    // leftover native session blocks the next VoiceInput — the chat mic — with
    // "Only one Recording object can be prepared at a given time."
    useEffect(
      () => () => {
        const rec = recorderRef.current;
        recorderRef.current = null;
        isRecordingRef.current = false;
        startingRef.current = false;
        if (rec) {
          if (activeRecording === rec) activeRecording = null;
          void disposeRecorder(rec);
        }
      },
      []
    );

    const startRecording = async () => {
      if (startingRef.current || isRecordingRef.current || recorderRef.current) return;
      // App-wide: don't start while any instance is mid-start (the native
      // recorder can't be prepared twice). The owner will finish or release it.
      if (recorderStarting) return;

      let recording: AudioRecorder | null = null;
      startingRef.current = true;
      recorderStarting = true;
      try {
        // Another VoiceInput instance (or a closed overlay) may still hold the
        // shared recorder. Tear it down before we start ours so two instances
        // don't both capture from the one hardware microphone.
        if (activeRecording) {
          const stale = activeRecording;
          activeRecording = null;
          await disposeRecorder(stale);
        }

        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          onError('not-allowed');
          return;
        }

        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });

        recording = new AudioModule.AudioRecorder(RECORDING_OPTIONS);
        await recording.prepareToRecordAsync();
        recording.record();

        recorderRef.current = recording;
        activeRecording = recording;
        isRecordingRef.current = true;
        setIsRecording(true);
        onStart();
        console.log('🎤 QVAC VoiceInput: recording started');
      } catch (err) {
        if (recording) {
          await disposeRecorder(recording);
        }
        if (activeRecording === recording) activeRecording = null;
        recorderRef.current = null;
        isRecordingRef.current = false;
        setIsRecording(false);
        console.error('VoiceInput start error:', err);
        onError(err instanceof Error ? err.message : 'Failed to start recording');
      } finally {
        startingRef.current = false;
        recorderStarting = false;
      }
    };

    const stopRecording = async () => {
      if (!isRecordingRef.current || !recorderRef.current) return;

      const recording = recorderRef.current;
      try {
        isRecordingRef.current = false;
        setIsRecording(false);
        recorderRef.current = null;

        await recording.stop();
        if (activeRecording === recording) activeRecording = null;
        // Read the file path before release() detaches the native object.
        const uri = recording.uri;
        try { recording.release(); } catch { /* already freed */ }

        await setAudioModeAsync({ allowsRecording: false });

        onEnd();

        if (!uri) {
          onError('no-speech');
          return;
        }

        console.log('🎤 QVAC VoiceInput: recording stopped, URI:', uri);
        onPartialResult('Transcribing...');

        const qvac = QVACService.getInstance();
        let state = qvac.getState();

        if (state.whisperStatus !== 'ready') {
          onPartialResult('Preparing voice model...');
          await qvac.initializeWhisper();
          state = qvac.getState();

          if (state.whisperStatus !== 'ready') {
            onError(`Whisper model failed to load: ${state.error || 'unknown error'}`);
            return;
          }
        }

        const transcription = await qvac.transcribeAudio(uri);
        // Whisper emits non-speech markers like "[BLANK_AUDIO]", "(silence)" or
        // "[ Silence ]" for empty/quiet clips — treat those as no-speech too.
        const trimmed = transcription
          .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        console.log('🎤 QVAC VoiceInput: transcription =', JSON.stringify(transcription));

        if (trimmed) {
          onResult(trimmed);
        } else {
          onError('no-speech');
        }

        try {
          const file = new File(uri);
          if (file.exists) file.delete();
        } catch {
          // ignore cleanup errors
        }
      } catch (err) {
        isRecordingRef.current = false;
        if (activeRecording === recording) activeRecording = null;
        recorderRef.current = null;
        setIsRecording(false);
        console.error('VoiceInput stop error:', err);
        onError(err instanceof Error ? err.message : 'Transcription failed');
      }
    };

    return <View style={styles.container} />;
  }
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    width: 0,
    height: 0,
  },
});

export default VoiceInput;
