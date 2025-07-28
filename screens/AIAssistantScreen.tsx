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
  Alert,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

interface Props {
  navigation: any;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const statusBarHeight = StatusBar.currentHeight || 0;

export default function AIAssistantScreen({ navigation }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! I\'m your AI assistant. I can help you with questions about Bitcoin, Lightning Network, and RGB assets. How can I help you today?',
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const typingAnim = useRef(new Animated.Value(0)).current;

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

    try {
      // Simulate AI response for now
      setTimeout(() => {
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: 'I understand you\'re asking about ' + messageText + '. I\'m here to help with Bitcoin, Lightning Network, and RGB asset questions. Could you provide more specific details about what you\'d like to know?',
          isUser: false,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, aiMessage]);
        setIsLoading(false);
      }, 1500);
    } catch (error) {
      console.error('AI response error:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'I\'m having trouble processing your request right now. Please try again.',
        isUser: false,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsLoading(false);
    }

    // Scroll to bottom
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
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
    <View style={styles.container}>
      {/* Extended Header with Gradient over Status Bar */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <SafeAreaView style={styles.headerSafeArea}>
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.headerBackButton}
              onPress={() => navigation.openDrawer ? navigation.openDrawer() : navigation.goBack()}
            >
              <Ionicons name="menu" size={24} color="white" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <View style={styles.headerIcon}>
                <Ionicons name="chatbubble" size={24} color="white" />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.headerTitle}>AI Assistant</Text>
                <Text style={styles.headerSubtitle}>Bitcoin & Crypto Expert</Text>
              </View>
            </View>
            <View style={styles.headerRight} />
          </View>
        </SafeAreaView>
      </LinearGradient>

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
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ask me about Bitcoin, Lightning, RGB..."
              placeholderTextColor={theme.colors.text.secondary}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={() => sendMessage(inputText)}
            />
            <TouchableOpacity
              style={[styles.sendButton, !inputText.trim() && styles.disabledButton]}
              onPress={() => sendMessage(inputText)}
              disabled={!inputText.trim() || isLoading}
            >
              <LinearGradient
                colors={inputText.trim() ? ['#667eea', '#764ba2'] : [theme.colors.gray[300], theme.colors.gray[300]]}
                style={styles.sendButtonGradient}
              >
                <Ionicons 
                  name="send" 
                  size={20} 
                  color={inputText.trim() ? "white" : theme.colors.text.secondary} 
                />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  headerGradient: {
    paddingTop: Platform.OS === 'android' ? statusBarHeight : 0,
  },
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    minHeight: 60,
  },
  headerBackButton: {
    padding: theme.spacing[1],
    marginRight: theme.spacing[3],
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    marginRight: theme.spacing[3],
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 24,
    paddingBottom: 16,
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
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface.primary,
    padding: 16,
    shadowColor: theme.colors.gray[900],
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
    color: theme.colors.text.primary,
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
    color: theme.colors.text.secondary,
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
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    marginLeft: 8,
  },
  inputContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text.primary,
    maxHeight: 120,
    paddingVertical: 12,
  },
  sendButton: {
    marginLeft: 12,
  },
  sendButtonGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
}); 