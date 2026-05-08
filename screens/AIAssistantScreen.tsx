// screens/AIAssistantScreen.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  Linking,
  Clipboard,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { theme } from '../theme';
import { MainHeader } from '../components';
import SpeechToText, { SpeechToTextRef } from '../components/SpeechToText';
import PaymentConfirmationModal from '../components/PaymentConfirmationModal';
import NostrContactsSelector from '../components/NostrContactsSelector';
import InvoiceQRCode from '../components/InvoiceQRCode';
import { EnhancedAIAssistant } from '../services/aiAssistantFunctions';
import * as Haptics from 'expo-haptics';
import Markdown from 'react-native-markdown-display';
import { BlurView } from 'expo-blur';
// Temporary interface to fix import issue
interface AIAssistantInterface {
  processMessage(message: string, history?: any[]): Promise<{
    text: string;
    functionCalled?: string;
    functionResult?: any;
  }>;
}

interface Props {
  navigation: any;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  functionCalled?: string;
  functionResult?: any;
}

interface PaymentDetails {
  type: 'lightning_address' | 'lightning_invoice' | 'nostr_contact';
  recipient: string;
  amount: number;
  description?: string;
  recipientName?: string;
  recipientAvatar?: string;
  lightningAddress?: string;
  isNostrContact?: boolean;
}

interface Contact {
  id: string;
  name: string;
  lightning_address?: string;
  node_pubkey?: string;
  notes?: string;
  avatar_url?: string;
  npub?: string;
  isNostrContact?: boolean;
  profile?: any;
}

interface AIResponse {
  text: string;
  functionCalled: string | null;
  functionResult?: {
    success?: boolean;
    payment_hash?: string;
    status?: string;
    message?: string;
    error?: string;
    contact?: {
      name?: string;
      npub?: string;
      lightning_address?: string;
      avatar_url?: string;
    };
  } | null;
}

const markdownStyles = {
  body: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    lineHeight: 24,
  },
  code_inline: {
    backgroundColor: theme.colors.primary[50],
    color: theme.colors.primary[700],
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  link: {
    color: theme.colors.primary[600],
    textDecorationLine: 'underline' as const,
  },
};

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function AIAssistantScreen({ navigation }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! I\'m your AI assistant specialized in Bitcoin, Lightning Network, and RGB assets. I can help you:\n\n💸 Pay Lightning invoices or addresses\n🧾 Generate invoices to receive payments\n🏪 Find Bitcoin-accepting merchants in Lugano\n📍 Get detailed merchant information\n👥 Pay friends from your Nostr contacts\n\nHow can I assist you today? 🚀\n\n💡 Tip: Try saying "Pay 1000 sats to alice@example.com", "Generate invoice for 5000 sats", or tap the contacts button to pay a friend!',
      isUser: false,
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceAvailable, setIsVoiceAvailable] = useState(true);
  const [partialText, setPartialText] = useState('');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [baseInputText, setBaseInputText] = useState('');

  // Payment confirmation state
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PaymentDetails | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Nostr contacts state
  const [showContactsSelector, setShowContactsSelector] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const speechToTextRef = useRef<SpeechToTextRef>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const typingAnim = useRef(new Animated.Value(0)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const messageAnimations = useRef(new Map()).current;

  // Initialize Enhanced AI Assistant
  const aiAssistant = useRef(new EnhancedAIAssistant()).current;

  // Get nostr state for better personalization  
  const nostrState = useSelector((state: RootState) => state.nostr);

  // Enhanced scroll to bottom function
  const scrollToBottom = useCallback((animated: boolean = true) => {
    if (!scrollViewRef.current) return;

    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    });
  }, []);

  // Add keyboard handling
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      () => {
        scrollToBottom(true);
      }
    );

    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        // Optional: Add any behavior you want when keyboard hides
      }
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, [scrollToBottom]);

  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  useEffect(() => {
    if (isListening) {
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
  }, [isListening]);

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

  // Animate new messages
  const animateMessage = useCallback((messageId: string) => {
    const animation = new Animated.Value(0);
    messageAnimations.set(messageId, animation);

    Animated.spring(animation, {
      toValue: 1,
      tension: 120,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, []);

  // Add message with auto-scroll
  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
    animateMessage(message.id);
    // Scroll after a short delay to ensure the message is rendered
    setTimeout(() => scrollToBottom(true), 100);
  }, [animateMessage, scrollToBottom]);

  const handleSpeechStart = () => {
    console.log('🎤 Speech recognition started');
    setIsListening(true);
    setPartialText('');
    setBaseInputText(inputText);
    Vibration.vibrate(50);
  };

  const handleSpeechEnd = () => {
    console.log('🛑 Speech recognition ended');
    setIsListening(false);
    setPartialText('');
    setBaseInputText('');
    Vibration.vibrate(100);
  };

  const handleSpeechResult = (text: string) => {
    console.log('✅ Final speech result:', text);
    if (!text.trim()) return;

    setInputText(prevText => {
      const cleanBaseText = baseInputText.trim();
      const cleanNewText = text.trim();

      if (cleanBaseText && cleanNewText) {
        return `${cleanBaseText} ${cleanNewText}`;
      } else if (cleanNewText) {
        return cleanNewText;
      } else {
        return cleanBaseText;
      }
    });

    setPartialText('');
  };

  const handlePartialResult = (text: string) => {
    console.log('🔄 Partial speech result:', text);
    setPartialText(text.trim());
  };

  const handleSpeechError = (error: string) => {
    console.error('❌ Speech recognition error:', error);
    setIsListening(false);
    setPartialText('');
    setBaseInputText('');

    let errorMessage = 'Speech recognition failed. Please try again.';

    if (error.includes('not-allowed')) {
      errorMessage = 'Microphone access denied. Please enable microphone permissions.';
      setIsVoiceAvailable(false);
    } else if (error.includes('network')) {
      errorMessage = 'Network error. Please check your connection.';
    } else if (error.includes('no-speech')) {
      errorMessage = 'No speech detected. Please speak clearly.';
    } else if (error.includes('not supported')) {
      errorMessage = 'Speech recognition is not supported on this device.';
      setIsVoiceAvailable(false);
    }

    Alert.alert('Voice Recognition Error', errorMessage);
  };

  const startListening = () => {
    if (!isVoiceAvailable) {
      Alert.alert(
        'Voice Recognition Unavailable',
        'Speech recognition is not available. Please type your message instead.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    console.log('🎤 Starting speech recognition...');
    speechToTextRef.current?.startListening();
  };

  const stopListening = () => {
    console.log('🛑 Stopping speech recognition...');
    speechToTextRef.current?.stopListening();
  };

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied', 'Text copied to clipboard!');
  };

  const openLink = (url: string) => {
    Linking.openURL(url).catch(err =>
      Alert.alert('Error', 'Could not open link')
    );
  };

  // Handle contact selection from Nostr contacts
  const handleContactSelection = (contact: Contact) => {
    if (!contact.lightning_address) {
      Alert.alert('No Lightning Address', 'This contact doesn\'t have a Lightning address set up.');
      return;
    }

    // Pre-fill input with contact payment
    setInputText(`Pay to ${contact.name} (${contact.lightning_address})`);
    setShowContactsSelector(false);

    // Optionally auto-send the message
    setTimeout(() => {
      sendMessage(`Pay to ${contact.name} (${contact.lightning_address})`);
    }, 500);
  };

  // Enhanced payment confirmation
  const confirmPayment = (paymentDetails: PaymentDetails) => {
    setPendingPayment(paymentDetails);
    setShowPaymentConfirmation(true);
  };

  const handlePaymentConfirm = async () => {
    if (!pendingPayment) return;

    setPaymentLoading(true);

    try {
      // Here you would call the actual payment function
      // For now, we'll simulate the payment
      await new Promise(resolve => setTimeout(resolve, 2000));

      setShowPaymentConfirmation(false);
      setPendingPayment(null);

      // Add success message
      const successMessage: Message = {
        id: Date.now().toString(),
        text: '✅ Payment sent successfully! Your transaction has been broadcasted to the Lightning Network.',
        isUser: false,
        timestamp: new Date(),
      };

      addMessage(successMessage);
    } catch (error) {
      Alert.alert('Payment Failed', 'Unable to process payment. Please try again.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const sendMessage = async (text: string) => {
    const messageText = text || inputText.trim();
    if (!messageText) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Clear input immediately after getting the message text
    setInputText('');
    setPartialText('');

    const userMessage: Message = {
      id: Date.now().toString(),
      text: messageText,
      isUser: true,
      timestamp: new Date(),
    };

    addMessage(userMessage);
    setIsLoading(true);

    try {
      const conversationHistory = messages.map(msg => ({
        role: msg.isUser ? 'user' as const : 'assistant' as const,
        content: msg.text
      }));

      const response = await aiAssistant.processMessage(messageText, conversationHistory) as AIResponse;

      // Check if this is a payment request and needs confirmation
      if ((response.functionCalled === 'pay_lightning_invoice' || response.functionCalled === 'pay_nostr_contact') && response.functionResult) {
        const amountMatch = messageText.match(/(\d+)\s*(sats?|satoshis?)/i);
        const addressMatch = messageText.match(/([a-zA-Z0-9]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|((lnbc|lntb)[a-zA-Z0-9]+)/i);

        // Handle Nostr contact payments
        if (response.functionCalled === 'pay_nostr_contact' && response.functionResult.contact) {
          const contact = response.functionResult.contact;
          const paymentDetails: PaymentDetails = {
            type: 'nostr_contact',
            recipient: contact.lightning_address || contact.name || contact.npub || 'Unknown contact',
            amount: amountMatch ? parseInt(amountMatch[1]) : 0,
            description: 'Payment to Nostr contact',
            recipientName: contact.name,
            recipientAvatar: contact.avatar_url,
            lightningAddress: contact.lightning_address,
            isNostrContact: true,
          };

          confirmPayment(paymentDetails);
          setIsLoading(false);
          return;
        }

        // Handle regular Lightning payments
        if (response.functionCalled === 'pay_lightning_invoice' && addressMatch) {
          // For Lightning addresses, we need the amount
          if (addressMatch[0].includes('@') && !amountMatch) {
            const errorMessage: Message = {
              id: (Date.now() + 1).toString(),
              text: "Please specify the amount in sats you want to send to this Lightning address.",
              isUser: false,
              timestamp: new Date(),
            };
            addMessage(errorMessage);
            setIsLoading(false);
            return;
          }

          // Show payment confirmation dialog
          const paymentDetails: PaymentDetails = {
            type: addressMatch[0].includes('@') ? 'lightning_address' : 'lightning_invoice',
            recipient: addressMatch[0],
            amount: amountMatch ? parseInt(amountMatch[1]) : 0,
            description: 'Payment via AI Assistant',
            lightningAddress: addressMatch[0].includes('@') ? addressMatch[0] : undefined,
          };

          confirmPayment(paymentDetails);
          setIsLoading(false);
          return;
        }
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response.text || 'Sorry, I could not process your request.',
        isUser: false,
        timestamp: new Date(),
        functionCalled: response.functionCalled || undefined,
        functionResult: response.functionResult || undefined
      };

      addMessage(aiMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('AI response error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "I'm having trouble processing your request right now. This might be due to network connectivity or service availability. Please check your connection and try again. 🔧",
        isUser: false,
        timestamp: new Date(),
      };
      addMessage(errorMessage);
    }

    setIsLoading(false);
  };

  const formatRecordingDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderFunctionResult = (functionCalled: string, functionResult: any) => {
    if (!functionResult) return null;

    switch (functionCalled) {
      case 'pay_lightning_invoice':
        return (
          <View style={styles.functionResult}>
            <Text style={styles.functionTitle}>💸 Payment Result</Text>
            {functionResult.success ? (
              <View>
                <Text style={styles.successText}>✅ Payment successful!</Text>
                <TouchableOpacity
                  onPress={() => copyToClipboard(functionResult.payment_hash)}
                  style={styles.copyButton}
                >
                  <Text style={styles.copyText}>📋 Copy Payment Hash</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.errorText}>❌ {functionResult.error}</Text>
            )}
          </View>
        );

      case 'generate_invoice':
        return functionResult.success ? (
          <InvoiceQRCode
            invoice={functionResult.invoice}
            amount={functionResult.amount_sats}
            description={functionResult.description}
            onCopy={() => {
              Alert.alert('Copied!', 'Lightning invoice copied to clipboard');
            }}
            onShare={() => {
              Alert.alert('Shared!', 'Lightning invoice shared successfully');
            }}
          />
        ) : (
          <View style={styles.functionResult}>
            <Text style={styles.functionTitle}>🧾 Invoice Generation Failed</Text>
            <Text style={styles.errorText}>❌ {functionResult.error}</Text>
          </View>
        );

      case 'find_merchant_locations':
        return (
          <View style={styles.functionResult}>
            <Text style={styles.functionTitle}>🏪 Merchants Found</Text>
            {functionResult.success ? (
              <ScrollView style={styles.merchantList} nestedScrollEnabled>
                {functionResult.merchants.map((merchant: any, index: number) => (
                  <View key={merchant.id} style={styles.merchantItem}>
                    <Text style={styles.merchantName}>{merchant.name}</Text>
                    <Text style={styles.merchantAddress}>{merchant.address}</Text>
                    {merchant.phone && (
                      <TouchableOpacity onPress={() => Linking.openURL(`tel:${merchant.phone}`)}>
                        <Text style={styles.merchantPhone}>📞 {merchant.phone}</Text>
                      </TouchableOpacity>
                    )}
                    {merchant.website && (
                      <TouchableOpacity onPress={() => openLink(merchant.website)}>
                        <Text style={styles.merchantWebsite}>🌐 Website</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.errorText}>❌ {functionResult.error}</Text>
            )}
          </View>
        );

      case 'get_merchant_info':
        return (
          <View style={styles.functionResult}>
            <Text style={styles.functionTitle}>📍 Merchant Info</Text>
            {functionResult.success ? (
              <View style={styles.merchantItem}>
                <Text style={styles.merchantName}>{functionResult.merchant.name}</Text>
                <Text style={styles.merchantAddress}>{functionResult.merchant.address}</Text>
                {functionResult.merchant.opening_hours && (
                  <Text style={styles.merchantHours}>🕒 {functionResult.merchant.opening_hours}</Text>
                )}
                {functionResult.merchant.phone && (
                  <TouchableOpacity onPress={() => Linking.openURL(`tel:${functionResult.merchant.phone}`)}>
                    <Text style={styles.merchantPhone}>📞 {functionResult.merchant.phone}</Text>
                  </TouchableOpacity>
                )}
                {functionResult.merchant.website && (
                  <TouchableOpacity onPress={() => openLink(functionResult.merchant.website)}>
                    <Text style={styles.merchantWebsite}>🌐 Website</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <Text style={styles.errorText}>❌ {functionResult.error}</Text>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  const renderMessage = (message: Message, index: number) => {
    const animation = messageAnimations.get(message.id) || new Animated.Value(1);

    return (
      <Animated.View
        key={message.id}
        style={[
          styles.messageContainer,
          message.isUser ? styles.userMessage : styles.aiMessage,
          {
            opacity: animation,
            transform: [{
              translateY: animation.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            }],
          }
        ]}
      >
        {!message.isUser && (
          <View style={styles.aiAvatar}>
            <LinearGradient
              colors={theme.colors.primary.gradient!}
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
              colors={theme.colors.primary.gradient!}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.userGradient}
            >
              <Text style={styles.userMessageText}>{message.text}</Text>
            </LinearGradient>
          ) : (
            <View>
              <Markdown style={markdownStyles}>
                {message.text}
              </Markdown>
              {message.functionCalled && message.functionResult &&
                renderFunctionResult(message.functionCalled, message.functionResult)
              }
            </View>
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
              colors={theme.colors.warning.gradient!}
              style={styles.avatarGradient}
            >
              <Ionicons name="person" size={16} color="white" />
            </LinearGradient>
          </View>
        )}
      </Animated.View>
    );
  };

  const renderTypingIndicator = () => (
    <View style={[styles.messageContainer, styles.aiMessage]}>
      <View style={styles.aiAvatar}>
        <LinearGradient
          colors={theme.colors.primary.gradient!}
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
        <Text style={styles.typingText}>AI is processing...</Text>
      </View>
    </View>
  );

  // Enhanced quick action buttons with better design
  const renderQuickActions = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.quickActionsContainer}
      contentContainerStyle={styles.quickActionsContent}
    >
      <TouchableOpacity
        style={styles.quickActionButton}
        onPress={() => setInputText('Generate an invoice for 1000 sats')}
      >
        <LinearGradient
          colors={theme.colors.success.gradient!}
          style={styles.quickActionGradient}
        >
          <Ionicons name="receipt" size={16} color="white" />
          <Text style={styles.quickActionText}>Invoice</Text>
        </LinearGradient>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.quickActionButton}
        onPress={() => setShowContactsSelector(true)}
      >
        <LinearGradient
          colors={['#8B5CF6', '#A855F7']}
          style={styles.quickActionGradient}
        >
          <Ionicons name="people" size={16} color="white" />
          <Text style={styles.quickActionText}>Contacts</Text>
        </LinearGradient>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.quickActionButton}
        onPress={() => setInputText('Find restaurants in Lugano')}
      >
        <LinearGradient
          colors={theme.colors.warning.gradient!}
          style={styles.quickActionGradient}
        >
          <Ionicons name="restaurant" size={16} color="white" />
          <Text style={styles.quickActionText}>Restaurants</Text>
        </LinearGradient>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.quickActionButton}
        onPress={() => setInputText('Find shops in Lugano')}
      >
        <LinearGradient
          colors={['#9C27B0', '#7B1FA2']}
          style={styles.quickActionGradient}
        >
          <Ionicons name="storefront" size={16} color="white" />
          <Text style={styles.quickActionText}>Shops</Text>
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );

  // Improved clear chat function
  const clearChatHistory = () => {
    Alert.alert(
      'Clear Chat History',
      'Are you sure you want to clear all chat history? This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            const welcomeMessage = {
              id: Date.now().toString(),
              text: 'Hello! I\'m your AI assistant specialized in Bitcoin, Lightning Network, and RGB assets. I can help you:\n\n💸 Pay Lightning invoices or addresses\n🧾 Generate invoices to receive payments\n🏪 Find Bitcoin-accepting merchants in Lugano\n📍 Get detailed merchant information\n👥 Pay friends from your Nostr contacts\n\nHow can I assist you today? 🚀\n\n💡 Tip: Try saying "Pay 1000 sats to alice@example.com", "Generate invoice for 5000 sats", or tap the contacts button to pay a friend!',
              isUser: false,
              timestamp: new Date(),
            };
            setMessages([welcomeMessage]);
            // Clear message animations
            messageAnimations.clear();
            // Scroll to top immediately
            scrollViewRef.current?.scrollTo({ y: 0, animated: false });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <MainHeader
        title="AI Assistant"
        subtitle="Your Bitcoin Companion"
        icon="chatbubble-ellipses"
        rightAction={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {nostrState.isConnected && (
              <View style={styles.nostrIndicator}>
                <Ionicons name="checkmark-circle" size={16} color={theme.colors.success[500]} />
              </View>
            )}
            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearChatHistory}
            >
              <Ionicons name="trash-outline" size={20} color="white" />
            </TouchableOpacity>
          </View>
        }
      />
      <View style={styles.chatContainer}>
        <LinearGradient
          colors={['#f8f9ff', '#e8f4f8']}
          style={styles.background}
        >
          {/* Hidden Speech-to-Text Component */}
          <SpeechToText
            ref={speechToTextRef}
            onStart={handleSpeechStart}
            onEnd={handleSpeechEnd}
            onResult={handleSpeechResult}
            onPartialResult={handlePartialResult}
            onError={handleSpeechError}
          />

          <KeyboardAvoidingView
            style={styles.content}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
          >
            <View style={styles.contentInner}>
              <ScrollView
                ref={scrollViewRef}
                style={styles.messagesContainer}
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                scrollEventThrottle={16}
                alwaysBounceVertical={false}
                bounces={true}
                onContentSizeChange={() => {
                  if (messages.length > 1) {
                    scrollToBottom(true);
                  }
                }}
                onLayout={() => {
                  if (messages.length > 1) {
                    scrollToBottom(false);
                  }
                }}
              >
                {messages.map((message, index) => renderMessage(message, index))}
                {isLoading && renderTypingIndicator()}
              </ScrollView>

              <TouchableWithoutFeedback onPress={dismissKeyboard}>
                <View style={styles.inputContainer}>
                  <BlurView
                    intensity={80}
                    tint="light"
                    style={styles.inputGradient}
                  >
                    {/* Enhanced Quick Actions */}
                    {renderQuickActions()}

                    <View style={styles.inputRow}>
                      <View style={styles.textInputContainer}>
                        <TextInput
                          style={styles.textInput}
                          value={inputText}
                          onChangeText={(text) => {
                            setInputText(text);
                            if (!isListening) {
                              setBaseInputText(text);
                            }
                          }}
                          placeholder={isListening ? "Listening... speak now" : "Ask me about Bitcoin or payments"}
                          placeholderTextColor={theme.colors.gray[400]}
                          multiline
                          maxLength={500}
                          returnKeyType="send"
                          onSubmitEditing={() => {
                            if (inputText.trim()) {
                              sendMessage(inputText.trim());
                              dismissKeyboard();
                            }
                          }}
                          blurOnSubmit={true}
                          editable={!isListening}
                        />

                        {/* Show partial speech results */}
                        {isListening && partialText && (
                          <View style={styles.partialTextContainer}>
                            <Text style={styles.partialText}>
                              "{partialText}"
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Voice input button */}
                      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                        <TouchableOpacity
                          style={[
                            styles.voiceButton,
                            isListening && styles.voiceButtonActive,
                            !isVoiceAvailable && styles.disabledButton
                          ]}
                          onPress={startListening}
                          disabled={!isVoiceAvailable || isLoading}
                        >
                          <LinearGradient
                            colors={isListening ? theme.colors.error.gradient! : ['#00d2d3', '#54a0ff']}
                            style={styles.buttonGradient}
                          >
                            <Ionicons
                              name={isListening ? "stop" : "mic"}
                              size={20}
                              color="white"
                            />
                          </LinearGradient>
                        </TouchableOpacity>
                      </Animated.View>

                      <TouchableOpacity
                        style={[styles.sendButton, !inputText.trim() && styles.disabledButton]}
                        onPress={() => sendMessage(inputText)}
                        disabled={!inputText.trim() || isLoading || isListening}
                      >
                        <LinearGradient
                          colors={inputText.trim() ? theme.colors.primary.gradient! : ['#E5E5EA', '#E5E5EA']}
                          style={styles.buttonGradient}
                        >
                          <Ionicons
                            name="send"
                            size={20}
                            color={inputText.trim() ? "white" : theme.colors.gray[400]}
                          />
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>

                    {isListening && (
                      <Animated.View style={[
                        styles.recordingIndicator,
                        {
                          opacity: pulseAnim.interpolate({
                            inputRange: [1, 1.3],
                            outputRange: [0.8, 1],
                          }),
                        },
                      ]}>
                        <View style={styles.recordingInfo}>
                          <View style={styles.recordingDot} />
                          <Text style={styles.recordingText}>
                            Listening... {formatRecordingDuration(recordingDuration)}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.stopRecordingButton}
                          onPress={stopListening}
                        >
                          <Text style={styles.stopRecordingText}>Tap to stop</Text>
                        </TouchableOpacity>
                      </Animated.View>
                    )}
                  </BlurView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </KeyboardAvoidingView>

          {/* Payment Confirmation Modal */}
          <PaymentConfirmationModal
            visible={showPaymentConfirmation}
            paymentDetails={pendingPayment}
            onConfirm={handlePaymentConfirm}
            onCancel={() => setShowPaymentConfirmation(false)}
            loading={paymentLoading}
          />

          {/* Nostr Contacts Selector */}
          <NostrContactsSelector
            visible={showContactsSelector}
            onSelectContact={handleContactSelection}
            onClose={() => setShowContactsSelector(false)}
          />
        </LinearGradient>
      </View>
    </View>
  );
}

// Enhanced styles with improved spacing and design
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  chatContainer: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    paddingBottom: theme.spacing[6], // Extra padding at bottom for better scrolling
    minHeight: screenHeight * 0.5, // Ensure minimum scrollable area
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: theme.spacing[4],
    alignItems: 'flex-end',
    width: '100%',
  },
  userMessage: {
    justifyContent: 'flex-end',
  },
  aiMessage: {
    justifyContent: 'flex-start',
  },
  aiAvatar: {
    marginRight: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  userAvatar: {
    marginLeft: theme.spacing[3],
    marginBottom: theme.spacing[1],
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
    padding: theme.spacing[4],
    ...theme.shadows.md,
  },
  userGradient: {
    padding: theme.spacing[4],
  },
  userMessageText: {
    fontSize: theme.typography.fontSize.base,
    lineHeight: 24,
    color: theme.colors.text.inverse,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  aiMessageText: {
    fontSize: theme.typography.fontSize.base,
    lineHeight: 24,
    color: theme.colors.text.primary,
    fontWeight: '400',
    letterSpacing: 0.3,
  },
  messageTime: {
    fontSize: theme.typography.fontSize.xs,
    marginTop: theme.spacing[2],
    fontWeight: '500',
  },
  userMessageTime: {
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'right',
  },
  aiMessageTime: {
    color: theme.colors.text.tertiary,
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary[500],
    marginHorizontal: 2,
  },
  typingText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    fontStyle: 'italic',
    marginLeft: theme.spacing[2],
  },
  // Enhanced quick actions
  quickActionsContainer: {
    marginBottom: theme.spacing[4],
  },
  quickActionsContent: {
    paddingHorizontal: theme.spacing[1],
  },
  quickActionButton: {
    marginRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    ...theme.shadows.sm,
  },
  quickActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
  },
  quickActionText: {
    fontSize: theme.typography.fontSize.xs,
    color: 'white',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    backgroundColor: 'transparent',
  },
  inputGradient: {
    padding: theme.spacing[3],
    paddingBottom: Platform.OS === 'ios' ? theme.spacing[5] : theme.spacing[3],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing[2],
  },
  textInputContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.shadows.sm,
    maxHeight: 100,
  },
  textInput: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    fontSize: theme.typography.fontSize.base,
    maxHeight: 80,
    minHeight: 40,
    color: theme.colors.text.primary,
    lineHeight: 20,
    letterSpacing: 0.3,
  },
  partialTextContainer: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.primary[100],
    backgroundColor: theme.colors.primary[50],
  },
  partialText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    fontStyle: 'italic',
    lineHeight: theme.typography.lineHeight.snug,
  },
  voiceButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  voiceButtonActive: {
    // Additional styling handled by gradient colors
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    marginTop: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.2)',
  },
  recordingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[1],
  },
  recordingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.error[500],
    marginRight: theme.spacing[2],
  },
  recordingText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error[600],
    fontWeight: '600',
  },
  stopRecordingButton: {
    alignSelf: 'center',
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: 'rgba(255,107,107,0.2)',
    borderRadius: theme.borderRadius.md,
  },
  stopRecordingText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error[600],
    fontWeight: '600',
  },
  voiceTips: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  voiceTipsText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    marginLeft: theme.spacing[2],
    flex: 1,
    lineHeight: 18,
    letterSpacing: 0.25,
  },

  // Function result styles
  functionResult: {
    marginTop: theme.spacing[3],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary[500],
  },
  functionTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[2],
    letterSpacing: 0.5,
  },
  successText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.success[700],
    fontWeight: '500',
    marginBottom: theme.spacing[1],
  },
  errorText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error[700],
    fontWeight: '500',
  },
  invoiceText: {
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
    letterSpacing: 0.3,
  },
  copyButton: {
    alignSelf: 'flex-start',
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.primary[100],
    borderRadius: theme.borderRadius.sm,
    marginTop: theme.spacing[1],
  },
  copyText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[700],
    fontWeight: '500',
  },
  merchantList: {
    maxHeight: 180,
  },
  merchantItem: {
    padding: theme.spacing[2],
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  merchantName: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
    letterSpacing: 0.3,
    lineHeight: 20,
  },
  merchantAddress: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[1],
    letterSpacing: 0.25,
    lineHeight: 16,
  },
  merchantPhone: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[1],
    fontWeight: '500',
    letterSpacing: 0.25,
    lineHeight: 16,
  },
  merchantWebsite: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[1],
    fontWeight: '500',
    letterSpacing: 0.25,
    lineHeight: 16,
  },
  merchantHours: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.success[700],
    marginBottom: theme.spacing[1],
    fontWeight: '500',
  },
  nostrIndicator: {
    padding: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
  },
  clearButton: {
    padding: 4,
    backgroundColor: 'rgba(255, 59, 48, 0.8)',
    borderRadius: 12,
  },
});