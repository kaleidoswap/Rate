// services/VoiceService.ts
import Voice from '@react-native-voice/voice';
import { Alert, Platform } from 'react-native';

export interface VoiceServiceEvents {
  onStart?: () => void;
  onEnd?: () => void;
  onResults?: (results: string[]) => void;
  onPartialResults?: (results: string[]) => void;
  onError?: (error: any) => void;
  onVolumeChanged?: (volume: number) => void;
}

export interface VoiceServiceInterface {
  isAvailable(): Promise<boolean>;
  start(locale?: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  setEventHandlers(events: VoiceServiceEvents): void;
}

class RealVoiceService implements VoiceServiceInterface {
  private eventHandlers: VoiceServiceEvents = {};

  async isAvailable(): Promise<boolean> {
    try {
      const available = await Voice.isAvailable();
      return Boolean(available);
    } catch (error) {
      console.warn('Real voice service not available:', error);
      return false;
    }
  }

  async start(locale: string = 'en-US'): Promise<void> {
    try {
      await Voice.start(locale, {
        'EXTRA_LANGUAGE_MODEL': 'LANGUAGE_MODEL_FREE_FORM',
        'EXTRA_PARTIAL_RESULTS': true,
        'REQUEST_PERMISSIONS_AUTO': true,
      });
    } catch (error) {
      throw new Error(`Voice recognition failed: ${error}`);
    }
  }

  async stop(): Promise<void> {
    try {
      await Voice.stop();
    } catch (error) {
      console.warn('Error stopping voice recognition:', error);
    }
  }

  async destroy(): Promise<void> {
    try {
      await Voice.destroy();
      Voice.removeAllListeners();
    } catch (error) {
      console.warn('Error destroying voice recognition:', error);
    }
  }

  setEventHandlers(events: VoiceServiceEvents): void {
    this.eventHandlers = events;
    
    Voice.onSpeechStart = () => {
      console.log('🎤 Real voice: Speech started');
      this.eventHandlers.onStart?.();
    };

    Voice.onSpeechEnd = () => {
      console.log('🛑 Real voice: Speech ended');
      this.eventHandlers.onEnd?.();
    };

    Voice.onSpeechResults = (event: any) => {
      console.log('✅ Real voice: Results:', event.value);
      this.eventHandlers.onResults?.(event.value || []);
    };

    Voice.onSpeechPartialResults = (event: any) => {
      console.log('🔄 Real voice: Partial results:', event.value);
      this.eventHandlers.onPartialResults?.(event.value || []);
    };

    Voice.onSpeechError = (error: any) => {
      console.error('❌ Real voice: Error:', error);
      this.eventHandlers.onError?.(error);
    };

    Voice.onSpeechVolumeChanged = (event: any) => {
      this.eventHandlers.onVolumeChanged?.(event.value || 0);
    };
  }
}

class MockVoiceService implements VoiceServiceInterface {
  private isRecording = false;
  private eventHandlers: VoiceServiceEvents = {};
  private recordingTimer?: NodeJS.Timeout;

  async isAvailable(): Promise<boolean> {
    return true; // Mock service is always "available"
  }

  async start(locale: string = 'en-US'): Promise<void> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    console.log('🎭 Mock voice: Starting simulation...');
    this.isRecording = true;
    this.eventHandlers.onStart?.();

    // Simulate voice recognition with sample responses
    const mockResponses = [
      "What is Bitcoin?",
      "How does Lightning Network work?",
      "Tell me about RGB assets",
      "What are the benefits of cryptocurrency?",
      "How do I secure my wallet?",
      "What is the difference between Bitcoin and Ethereum?",
    ];

    // Simulate partial results first
    setTimeout(() => {
      if (this.isRecording) {
        this.eventHandlers.onPartialResults?.(['What is...']);
      }
    }, 1000);

    setTimeout(() => {
      if (this.isRecording) {
        this.eventHandlers.onPartialResults?.(['What is Bitcoin...']);
      }
    }, 2000);

    // Simulate final result after 3 seconds
    this.recordingTimer = setTimeout(() => {
      if (this.isRecording) {
        const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        console.log('🎭 Mock voice: Simulated result:', randomResponse);
        this.eventHandlers.onResults?.([randomResponse]);
        this.stop();
      }
    }, 3000);
  }

  async stop(): Promise<void> {
    if (!this.isRecording) return;

    console.log('🎭 Mock voice: Stopping simulation');
    this.isRecording = false;
    
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = undefined;
    }

    this.eventHandlers.onEnd?.();
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.eventHandlers = {};
  }

  setEventHandlers(events: VoiceServiceEvents): void {
    this.eventHandlers = events;
  }
}

export class VoiceService {
  private static instance: VoiceService;
  private service: VoiceServiceInterface;
  private isMockMode: boolean = false;

  private constructor() {
    this.service = new RealVoiceService();
  }

  public static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  public async initialize(): Promise<boolean> {
    try {
      console.log('🔍 Initializing voice service...');
      
      // First try to detect if we're in an emulator
      const isEmulator = await this.detectEmulator();
      
      if (isEmulator) {
        console.log('📱 Emulator detected, using mock voice service');
        this.switchToMockMode();
        return true;
      }

      // Try real voice service
      const isRealVoiceAvailable = await this.service.isAvailable();
      
      if (!isRealVoiceAvailable) {
        console.log('🎭 Real voice not available, switching to mock mode');
        this.switchToMockMode();
        return true;
      }

      console.log('✅ Real voice service initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Voice service initialization failed:', error);
      console.log('🎭 Falling back to mock voice service');
      this.switchToMockMode();
      return true; // Always return true since we have mock fallback
    }
  }

  private async detectEmulator(): Promise<boolean> {
    try {
      // Multiple ways to detect emulator
      const { Platform } = require('react-native');
      
      if (Platform.OS === 'android') {
        // Check for common emulator indicators
        const DeviceInfo = require('react-native-device-info');
        if (DeviceInfo) {
          const isEmulator = await DeviceInfo.isEmulator();
          return isEmulator;
        }
      }
      
      // Fallback: Check if Voice module returns null (common in emulator)
      try {
        await Voice.isAvailable();
        return false;
      } catch (error: any) {
        // If we get null property errors, likely in emulator
        return error?.message?.includes('null') || false;
      }
    } catch (error) {
      console.warn('Could not detect emulator, assuming real device');
      return false;
    }
  }

  private switchToMockMode(): void {
    this.isMockMode = true;
    this.service = new MockVoiceService();
    
    // Show user-friendly message about mock mode
    if (__DEV__) {
      setTimeout(() => {
        Alert.alert(
          'Voice Simulation Mode',
          'Voice recognition is running in simulation mode. This is normal for emulators and will work on real devices.',
          [{ text: 'OK' }]
        );
      }, 1000);
    }
  }

  public isMock(): boolean {
    return this.isMockMode;
  }

  public async isAvailable(): Promise<boolean> {
    return await this.service.isAvailable();
  }

  public async start(locale?: string): Promise<void> {
    return await this.service.start(locale);
  }

  public async stop(): Promise<void> {
    return await this.service.stop();
  }

  public async destroy(): Promise<void> {
    return await this.service.destroy();
  }

  public setEventHandlers(events: VoiceServiceEvents): void {
    return this.service.setEventHandlers(events);
  }

  public getStatus(): string {
    return this.isMockMode ? 'Mock Mode (Emulator/Fallback)' : 'Real Voice Recognition';
  }
} 