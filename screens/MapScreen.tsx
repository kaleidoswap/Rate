// screens/MapScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { Card } from '../components';

const statusBarHeight = StatusBar.currentHeight || 0;

interface Props {
  navigation: any;
}

export default function MapScreen({ navigation }: Props) {
  const [isLoading, setIsLoading] = useState(true);

  const handleLoadEnd = () => {
    setIsLoading(false);
  };

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
            <View style={styles.headerContent}>
              <View style={styles.headerIcon}>
                <Ionicons name="map" size={24} color={theme.colors.text.inverse} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.headerTitle}>Bitcoin Map</Text>
                <Text style={styles.headerSubtitle}>Discover Bitcoin-accepting venues worldwide</Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Map Container */}
      <View style={styles.mapContainer}>
        <Card variant="elevated" style={styles.mapCard}>
          <WebView
            source={{ uri: 'https://btcmap.org/map#16/46.00607/8.95201' }}
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
        </Card>
      </View>
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
    paddingBottom: theme.spacing[4],
  },
  
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
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
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: 2,
  },
  
  headerSubtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  

  
  mapContainer: {
    flex: 1,
    padding: theme.spacing[4],
  },
  
  mapCard: {
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface.primary,
  },
  
  webview: {
    flex: 1,
  },
}); 