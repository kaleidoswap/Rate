// screens/AIAssistantScreen.tsx
import React, { useState, useRef } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  navigation: any;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

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

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: text.trim(),
      isUser: true,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      // Simulate AI response for demo purposes
      const responses = [
        "Bitcoin is a decentralized digital currency that operates on a peer-to-peer network without central authority.",
        "Lightning Network is a layer-2 scaling solution for Bitcoin that enables fast, cheap transactions.",
        "RGB assets are colored coins built on Bitcoin that represent various digital assets and contracts.",
        "To secure your wallet, always use strong passwords, enable 2FA, and keep your seed phrase safe.",
        "Transaction fees on Bitcoin vary based on network congestion. Lightning Network offers much lower fees.",
        "RGB protocol allows for smart contracts and asset issuance on Bitcoin while maintaining privacy.",
        "Always verify addresses before sending transactions. Double-check everything to avoid mistakes.",
        "Cold storage like hardware wallets provide the best security for long-term Bitcoin storage.",
      ];

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: randomResponse,
        isUser: false,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('AI response error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, I\'m having trouble processing your request. Please try again.',
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

  const renderMessage = (message: Message) => (
    <View
      key={message.id}
      style={[
        styles.messageContainer,
        message.isUser ? styles.userMessage : styles.aiMessage,
      ]}
    >
      <Text style={[
        styles.messageText,
        message.isUser ? styles.userMessageText : styles.aiMessageText,
      ]}>
        {message.text}
      </Text>
      <Text style={styles.messageTime}>
        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Assistant</Text>
        <View style={{ width: 24 }} />
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
          {isLoading && (
            <View style={[styles.messageContainer, styles.aiMessage]}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>AI is thinking...</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type your message..."
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
            <Ionicons name="send" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
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
    marginBottom: 15,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    padding: 12,
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'white',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  userMessageText: {
    color: 'white',
  },
  aiMessageText: {
    color: '#333',
  },
  messageTime: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    opacity: 0.7,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 20,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
}); 