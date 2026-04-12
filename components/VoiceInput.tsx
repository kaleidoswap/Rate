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
    const [isRecording, setIsRecording] = useState(false);

    useImperativeHandle(ref, () => ({
      startListening: () => startRecording(),
      stopListening: () => stopRecording(),
    }));

    const startRecording = async () => {
      if (isRecording) return;

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

        const recording = new Audio.Recording();
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
        setIsRecording(true);
        onStart();
        console.log('🎤 QVAC VoiceInput: recording started');
      } catch (err) {
        console.error('VoiceInput start error:', err);
        onError(err instanceof Error ? err.message : 'Failed to start recording');
      }
    };

    const stopRecording = async () => {
      if (!isRecording || !recorderRef.current) return;

      try {
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
        const state = qvac.getState();

        if (state.whisperStatus !== 'ready') {
          onError('Whisper model not loaded yet. Please wait for the model to finish downloading.');
          return;
        }

        const transcription = await qvac.transcribeAudio(uri);
        const trimmed = transcription.trim();

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
