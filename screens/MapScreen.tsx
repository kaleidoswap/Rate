// screens/MapScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

interface Props {
  navigation: any;
}

export default function MapScreen({ navigation }: Props) {
  const [isLoading, setIsLoading] = useState(true);

  const handleLoadEnd = () => {
    setIsLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bitcoin Map</Text>
        <Text style={styles.headerSubtitle}>Discover Bitcoin-accepting venues worldwide</Text>
      </View>

      <View style={styles.mapContainer}>
        <WebView
          source={{ uri: 'https://btcmap.org/map#14/45.99076/8.96278' }}
          style={styles.webview}
          onLoadEnd={handleLoadEnd}
          startInLoadingState={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={Platform.OS === 'ios'}
          allowsFullscreenVideo={true}
          scrollEnabled={true}
          bounces={false}
        />

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading Bitcoin Map...</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: 'white',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
}); 