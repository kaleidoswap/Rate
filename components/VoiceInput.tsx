// components/VoiceInput.tsx
import React, { useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import QVACService from '../services/QVACService';

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

    const startRecording = async () => {
      if (startingRef.current || isRecordingRef.current || recorderRef.current) return;

      let recording: Audio.Recording | null = null;
      startingRef.current = true;
      try {
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
        recorderRef.current = null;
        isRecordingRef.current = false;
        setIsRecording(false);
        console.error('VoiceInput start error:', err);
        onError(err instanceof Error ? err.message : 'Failed to start recording');
      } finally {
        startingRef.current = false;
      }
    };

    const stopRecording = async () => {
      if (!isRecordingRef.current || !recorderRef.current) return;

      try {
        isRecordingRef.current = false;
        setIsRecording(false);
        const recording = recorderRef.current;
        recorderRef.current = null;

        await recording.stopAndUnloadAsync();
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
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          // ignore cleanup errors
        }
      } catch (err) {
        isRecordingRef.current = false;
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
