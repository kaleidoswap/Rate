// components/VoiceInput.tsx
import React, { useRef, useImperativeHandle, forwardRef, useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import { File } from 'expo-file-system';
import QVACService from '../services/QVACService';

// expo-av exposes a SINGLE native recorder for the whole process: only one
// Audio.Recording can be prepared at a time, app-wide. Multiple VoiceInput
// instances can be mounted simultaneously on the tab navigator (the AI chat
// screen's mic + the dashboard voice-agent overlay), so per-instance refs are
// not enough — without coordination a second instance calls prepareToRecordAsync
// while the first still owns the native recorder and throws
// "Only one Recording object can be prepared at a given time." This module-level
// handle mirrors the native singleton so every instance shares one source of
// truth and we can always release it (on stop, error, or unmount).
let activeRecording: Audio.Recording | null = null;
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
    const recorderRef = useRef<Audio.Recording | null>(null);
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
          rec.stopAndUnloadAsync().catch(() => {
            /* already released */
          });
        }
      },
      []
    );

    const startRecording = async () => {
      if (startingRef.current || isRecordingRef.current || recorderRef.current) return;
      // App-wide: don't start while any instance is mid-start (the native
      // recorder can't be prepared twice). The owner will finish or release it.
      if (recorderStarting) return;

      let recording: Audio.Recording | null = null;
      startingRef.current = true;
      recorderStarting = true;
      try {
        // Another VoiceInput instance (or a closed overlay) may have left the
        // app-wide native recorder prepared. Only one can exist at a time, so
        // tear down the stale one before preparing ours — otherwise
        // prepareToRecordAsync throws "Only one Recording object can be prepared
        // at a given time."
        if (activeRecording) {
          const stale = activeRecording;
          activeRecording = null;
          try {
            await stale.stopAndUnloadAsync();
          } catch {
            /* already released */
          }
        }

        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          onError('not-allowed');
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        recording = new Audio.Recording();
        await recording.prepareToRecordAsync({
          isMeteringEnabled: false,
          android: {
            extension: '.wav',
            outputFormat: Audio.AndroidOutputFormat.DEFAULT,
            audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 256000,
          },
          ios: {
            extension: '.wav',
            outputFormat: Audio.IOSOutputFormat.LINEARPCM,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 256000,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {},
        });
        await recording.startAsync();

        recorderRef.current = recording;
        activeRecording = recording;
        isRecordingRef.current = true;
        setIsRecording(true);
        onStart();
        console.log('🎤 QVAC VoiceInput: recording started');
      } catch (err) {
        if (recording) {
          try {
            await recording.stopAndUnloadAsync();
          } catch {
            /* ignore cleanup */
          }
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

        await recording.stopAndUnloadAsync();
        if (activeRecording === recording) activeRecording = null;
        const uri = recording.getURI();

        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

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
