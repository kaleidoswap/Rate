// screens/AIAssistantScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import PremAI from 'premai';
import { VoiceService } from '../services/VoiceService';

interface Props {
  navigation: any;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

const { width: screenWidth } = Dimensions.get('window');

export default function AIAssistantScreen({ navigation }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! I\'m your AI assistant specialized in Bitcoin, Lightning Network, and RGB assets. I can help you understand cryptocurrency concepts, wallet security, transaction processes, and much more. How can I assist you today? 🚀',
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceAvailable, setIsVoiceAvailable] = useState(false);
  const [voiceResults, setVoiceResults] = useState<string[]>([]);
  const [partialResults, setPartialResults] = useState<string[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<string>('Initializing...');
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const typingAnim = useRef(new Animated.Value(0)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const voiceService = useRef<VoiceService>(VoiceService.getInstance()).current;

  // Initialize PremAI client
  const premaiClient = new PremAI({
    apiKey: 'premKey_s1rKUkWbb0JbVRUU12U6y6bnUZJjaNZa7a3z',
  });

  useEffect(() => {
    // Initialize voice service
    const initializeVoice = async () => {
      try {
        console.log('🔍 Initializing voice service...');
        
        // Set up event handlers
        voiceService.setEventHandlers({
          onStart: onSpeechStart,
          onEnd: onSpeechEnd,
          onResults: onSpeechResults,
          onPartialResults: onSpeechPartialResults,
          onError: onSpeechError,
          onVolumeChanged: onSpeechVolumeChanged,
        });

        // Initialize the service
        const success = await voiceService.initialize();
        const available = await voiceService.isAvailable();
        
        setIsVoiceAvailable(success && available);
        setVoiceStatus(voiceService.getStatus());
        
        console.log('✅ Voice service initialized:', {
          success,
          available,
          status: voiceService.getStatus(),
          isMock: voiceService.isMock()
        });
        
      } catch (error) {
        console.error('❌ Voice service initialization failed:', error);
        setIsVoiceAvailable(false);
        setVoiceStatus('Failed to initialize');
      }
    };

    initializeVoice();

    return () => {
      // Clean up voice service and timer
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      voiceService.destroy();
    };
  }, []);

  useEffect(() => {
    if (isRecording) {
      // Pulse animation for recording button
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Recording timer
      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } else {
      pulseAnim.setValue(1);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      setRecordingDuration(0);
    }

    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
    };
  }, [isRecording]);

  useEffect(() => {
    if (isLoading) {
      // Typing indicator animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(typingAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(typingAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      typingAnim.setValue(0);
    }
  }, [isLoading]);

  const onSpeechStart = () => {
    console.log('🎤 Voice service: Speech started');
    setVoiceResults([]);
    setPartialResults([]);
  };

  const onSpeechEnd = () => {
    console.log('🛑 Voice service: Speech ended');
    setIsRecording(false);
  };

  const onSpeechError = (error: any) => {
    console.error('❌ Voice service: Error:', error);
    setIsRecording(false);
    
    let errorMessage = 'Voice recognition failed. Please try again.';
    
    if (voiceService.isMock()) {
      errorMessage = 'Voice simulation encountered an error. This is normal in emulator mode.';
    } else if (error?.message) {
      if (error.message.includes('permission')) {
        errorMessage = 'Microphone permission denied. Please enable microphone access.';
      } else if (error.message.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message.includes('busy')) {
        errorMessage = 'Voice service is busy. Please wait a moment and try again.';
      }
    }
    
    Alert.alert('Voice Recognition', errorMessage);
  };

  const onSpeechResults = (results: string[]) => {
    console.log('✅ Voice service: Results:', results);
    setVoiceResults(results);
    
    if (results.length > 0) {
      const bestResult = results[0];
      setInputText(prevText => {
        // If there's existing text, add a space before the new voice input
        return prevText.trim() ? `${prevText.trim()} ${bestResult}` : bestResult;
      });
    }
  };

  const onSpeechPartialResults = (partials: string[]) => {
    console.log('🔄 Voice service: Partial results:', partials);
    setPartialResults(partials);
  };

  const onSpeechVolumeChanged = (volume: number) => {
    // Could be used for visual feedback of voice volume
    // console.log('🔊 Volume changed:', volume);
  };

  const startVoiceRecording = async () => {
    if (isRecording) {
      await stopVoiceRecording();
      return;
    }

    if (!isVoiceAvailable) {
      Alert.alert(
        'Voice Not Available', 
        `Voice recognition is not available. Status: ${voiceStatus}`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      // Haptic feedback
      Vibration.vibrate(50);
      
      setIsRecording(true);
      setVoiceResults([]);
      setPartialResults([]);
      
      console.log('🎤 Starting voice recording...');
      
      // Use our abstracted voice service
      await voiceService.start('en-US');
      
      console.log('✅ Voice recording started successfully');
    } catch (error) {
      console.error('❌ Error starting voice recording:', error);
      setIsRecording(false);
      
      let errorMessage = 'Failed to start voice recording.';
      
      if (voiceService.isMock()) {
        errorMessage = 'Voice simulation failed to start. This can happen in emulator environments.';
      } else {
        errorMessage = 'Voice recognition failed to start. Please check your microphone permissions and try again.';
      }
      
      Alert.alert('Voice Recording Error', errorMessage);
    }
  };

  const stopVoiceRecording = async () => {
    try {
      await voiceService.stop();
      setIsRecording(false);
      
      // Haptic feedback
      Vibration.vibrate(100);
      
      console.log('🛑 Voice recording stopped');
      
      // Auto-send if we got voice results and no manual text
      if (voiceResults.length > 0 && !inputText.trim()) {
        const voiceText = voiceResults[0];
        if (voiceText.trim()) {
          setInputText(voiceText);
          // Auto-send after a short delay to allow user to see the transcription
          setTimeout(() => {
            sendMessage(voiceText);
          }, 500);
        }
      }
    } catch (error) {
      console.error('❌ Error stopping voice recording:', error);
      setIsRecording(false);
    }
  };

  const sendMessage = async (text: string) => {
    const messageText = text || inputText.trim();
    if (!messageText) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: messageText,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setVoiceResults([]);
    setPartialResults([]);

    try {
      // Use PremAI for actual AI responses
      const response = await premaiClient.chat.completions({
        messages: [
          {
            role: 'system' as any,
            content: 'You are a helpful AI assistant specializing in Bitcoin, Lightning Network, and RGB assets. Provide accurate, helpful information about cryptocurrency, blockchain technology, and digital assets. Keep responses concise but informative. Use emojis occasionally to make responses more engaging.' as any
          },
          {
            role: 'user' as any,
            content: messageText as any
          }
        ],
        model: 'claude-4-sonnet', // Using Claude model
      });

      const aiResponseText = response.choices?.[0]?.message?.content || 'Sorry, I couldn\'t generate a response. Please try again.';
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: aiResponseText,
        isUser: false,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('PremAI response error:', error);
      
      // Enhanced fallback responses with more context
      const fallbackResponses = [
        "I'm having trouble connecting to my AI service right now. This might be due to network connectivity or API key configuration. Please check your connection and try again. 🔧",
        "There seems to be a network issue preventing me from processing your request. Please ensure you have a stable internet connection and try again. 📡",
        "I'm experiencing some technical difficulties at the moment. This could be temporary - please try again in a few moments. If the issue persists, please check your API configuration. ⚡",
      ];

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }

    // Scroll to bottom
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const formatRecordingDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderMessage = (message: Message, index: number) => (
    <Animated.View
      key={message.id}
      style={[
        styles.messageContainer,
        message.isUser ? styles.userMessage : styles.aiMessage,
        {
          opacity: 1,
          transform: [{
            translateY: 0
          }]
        }
      ]}
    >
      {!message.isUser && (
        <View style={styles.aiAvatar}>
          <LinearGradient
            colors={['#667eea', '#764ba2']}
            style={styles.avatarGradient}
          >
            <Ionicons name="sparkles" size={16} color="white" />
          </LinearGradient>
        </View>
      )}
      
      <View style={[
        styles.messageBubble,
        message.isUser ? styles.userBubble : styles.aiBubble,
      ]}>
        {message.isUser ? (
          <LinearGradient
            colors={['#667eea', '#764ba2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.userGradient}
          >
            <Text style={styles.userMessageText}>{message.text}</Text>
          </LinearGradient>
        ) : (
          <Text style={styles.aiMessageText}>{message.text}</Text>
        )}
        
        <Text style={[
          styles.messageTime,
          message.isUser ? styles.userMessageTime : styles.aiMessageTime
        ]}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
      
      {message.isUser && (
        <View style={styles.userAvatar}>
          <LinearGradient
            colors={['#f093fb', '#f5576c']}
            style={styles.avatarGradient}
          >
            <Ionicons name="person" size={16} color="white" />
          </LinearGradient>
        </View>
      )}
    </Animated.View>
  );

  const renderTypingIndicator = () => (
    <View style={[styles.messageContainer, styles.aiMessage]}>
      <View style={styles.aiAvatar}>
        <LinearGradient
          colors={['#667eea', '#764ba2']}
          style={styles.avatarGradient}
        >
          <Ionicons name="sparkles" size={16} color="white" />
        </LinearGradient>
      </View>
      
      <View style={[styles.messageBubble, styles.aiBubble]}>
        <View style={styles.typingContainer}>
          <Animated.View style={[
            styles.typingDot,
            {
              opacity: typingAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0.3, 1, 0.3],
              }),
            },
          ]} />
          <Animated.View style={[
            styles.typingDot,
            {
              opacity: typingAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [1, 0.3, 1],
              }),
            },
          ]} />
          <Animated.View style={[
            styles.typingDot,
            {
              opacity: typingAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0.3, 1, 0.3],
              }),
            },
          ]} />
        </View>
        <Text style={styles.typingText}>AI is thinking...</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#f8f9ff', '#e8f4f8']}
        style={styles.background}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.headerIcon}>
              <LinearGradient
                colors={['#667eea', '#764ba2']}
                style={styles.headerIconGradient}
              >
                <Ionicons name="sparkles" size={24} color="white" />
              </LinearGradient>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>AI Assistant</Text>
              <Text style={styles.headerSubtitle}>
                {voiceService.isMock() ? 'Bitcoin Expert • Voice: Simulation' : 'Bitcoin & Crypto Expert'}
              </Text>
            </View>
            <View style={styles.voiceIndicator}>
              <Ionicons 
                name="mic" 
                size={16} 
                color={isVoiceAvailable ? (isRecording ? "#ff6b6b" : "#28a745") : "#ccc"} 
              />
              {__DEV__ && (
                <TouchableOpacity 
                  onPress={() => {
                    console.log('🔧 Debug: Toggling voice availability');
                    setIsVoiceAvailable(!isVoiceAvailable);
                  }}
                  style={styles.debugButton}
                >
                  <Text style={styles.debugText}>
                    {isVoiceAvailable ? '✓' : '✗'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <KeyboardAvoidingView 
          style={styles.content}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.map(renderMessage)}
            {isLoading && renderTypingIndicator()}
          </ScrollView>

          <View style={styles.inputContainer}>
            <LinearGradient
              colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.95)']}
              style={styles.inputGradient}
            >
              <View style={styles.inputRow}>
                <View style={styles.textInputContainer}>
                  <TextInput
                    style={styles.textInput}
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder={isRecording ? "Listening..." : "Ask me about Bitcoin, Lightning, RGB..."}
                    placeholderTextColor="#8E8E93"
                    multiline
                    maxLength={500}
                    returnKeyType="send"
                    onSubmitEditing={() => sendMessage(inputText)}
                    editable={!isRecording}
                  />
                  
                  {/* Show partial voice results */}
                  {isRecording && partialResults.length > 0 && (
                    <Text style={styles.partialResultText}>
                      "{partialResults[0]}"
                    </Text>
                  )}
                </View>
                
                {/* Voice input button */}
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <TouchableOpacity
                    style={[
                      styles.voiceButton,
                      isRecording && styles.voiceButtonActive,
                      !isVoiceAvailable && styles.disabledButton
                    ]}
                    onPress={startVoiceRecording}
                    disabled={!isVoiceAvailable || isLoading}
                  >
                    <LinearGradient
                      colors={isRecording ? ['#ff6b6b', '#ee5a24'] : ['#00d2d3', '#54a0ff']}
                      style={styles.buttonGradient}
                    >
                      <Ionicons 
                        name={isRecording ? "stop" : "mic"} 
                        size={20} 
                        color="white" 
                      />
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>

                <TouchableOpacity
                  style={[styles.sendButton, !inputText.trim() && styles.disabledButton]}
                  onPress={() => sendMessage(inputText)}
                  disabled={!inputText.trim() || isLoading || isRecording}
                >
                  <LinearGradient
                    colors={inputText.trim() ? ['#667eea', '#764ba2'] : ['#E5E5EA', '#E5E5EA']}
                    style={styles.buttonGradient}
                  >
                    <Ionicons 
                      name="send" 
                      size={20} 
                      color={inputText.trim() ? "white" : "#8E8E93"} 
                    />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
              
              {isRecording && (
                <Animated.View style={[
                  styles.recordingIndicator,
                  {
                    opacity: pulseAnim.interpolate({
                      inputRange: [1, 1.3],
                      outputRange: [0.7, 1],
                    }),
                  },
                ]}>
                  <View style={styles.recordingInfo}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingText}>
                      Recording... {formatRecordingDuration(recordingDuration)}
                    </Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.stopRecordingButton}
                    onPress={stopVoiceRecording}
                  >
                    <Text style={styles.stopRecordingText}>Tap to stop</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Voice input tips */}
              {!isRecording && isVoiceAvailable && messages.length === 1 && (
                <View style={styles.voiceTips}>
                  <Ionicons name="bulb-outline" size={14} color="#8E8E93" />
                  <Text style={styles.voiceTipsText}>
                    Tip: Hold the microphone button to record your voice, or type your message
                  </Text>
                </View>
              )}
            </LinearGradient>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    marginRight: 12,
  },
  headerIconGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  voiceIndicator: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 20,
    paddingBottom: 10,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-end',
  },
  userMessage: {
    justifyContent: 'flex-end',
  },
  aiMessage: {
    justifyContent: 'flex-start',
  },
  aiAvatar: {
    marginRight: 8,
    marginBottom: 4,
  },
  userAvatar: {
    marginLeft: 8,
    marginBottom: 4,
  },
  avatarGradient: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageBubble: {
    maxWidth: screenWidth * 0.75,
    borderRadius: 20,
    overflow: 'hidden',
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'white',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  userGradient: {
    padding: 16,
  },
  userMessageText: {
    fontSize: 16,
    lineHeight: 22,
    color: 'white',
    fontWeight: '500',
  },
  aiMessageText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#1a1a1a',
    fontWeight: '400',
  },
  messageTime: {
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
  },
  userMessageTime: {
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'right',
  },
  aiMessageTime: {
    color: '#8E8E93',
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#667eea',
    marginHorizontal: 2,
  },
  typingText: {
    fontSize: 14,
    color: '#8E8E93',
    fontStyle: 'italic',
    marginLeft: 8,
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  inputGradient: {
    padding: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  textInputContainer: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  textInput: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    fontSize: 16,
    maxHeight: 120,
    color: '#1a1a1a',
  },
  partialResultText: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    fontSize: 14,
    color: '#667eea',
    fontStyle: 'italic',
  },
  voiceButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 8,
    overflow: 'hidden',
  },
  voiceButtonActive: {
    // Additional styling handled by gradient colors
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  buttonGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  recordingIndicator: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.2)',
  },
  recordingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff6b6b',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 14,
    color: '#ff6b6b',
    fontWeight: '600',
  },
  stopRecordingButton: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,107,107,0.2)',
    borderRadius: 12,
  },
  stopRecordingText: {
    fontSize: 12,
    color: '#ff6b6b',
    fontWeight: '600',
  },
  voiceTips: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(134, 126, 234, 0.1)',
    borderRadius: 12,
  },
  voiceTipsText: {
    fontSize: 12,
    color: '#8E8E93',
    marginLeft: 6,
    flex: 1,
  },
  debugText: {
    fontSize: 10,
    color: '#8E8E93',
    marginLeft: 4,
  },
  debugButton: {
    marginLeft: 4,
    padding: 4,
  },
}); 