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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { Card } from '../components';

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
      {/* Modern Header with Gradient */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  
  headerGradient: {
    paddingBottom: theme.spacing[1],
  },
  
  header: {
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[5],
  },
  
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[4],
  },
  
  headerText: {
    flex: 1,
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
  },
  
  headerSubtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.inverse,
    opacity: 0.9,
  },
  
  mapContainer: {
    flex: 1,
    padding: theme.spacing[4],
    position: 'relative',
  },
  
  mapCard: {
    flex: 1,
    padding: 0,
    overflow: 'hidden',
  },
  
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: theme.borderRadius.lg,
  },
  
  loadingContainer: {
    position: 'absolute',
    top: theme.spacing[4],
    left: theme.spacing[4],
    right: theme.spacing[4],
    bottom: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
  
  loadingBackground: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  loadingContent: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing[8],
  },
  
  loadingIconContainer: {
    width: 80,
    height: 80,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[5],
    ...theme.shadows.md,
  },
  
  loadingText: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
    textAlign: 'center',
  },
  
  loadingSubtext: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: theme.typography.lineHeight.relaxed,
  },
  
  footer: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  
  infoCard: {
    backgroundColor: theme.colors.primary[50],
    borderColor: theme.colors.primary[100],
    borderWidth: 1,
  },
  
  infoContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  infoText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginLeft: theme.spacing[3],
    lineHeight: theme.typography.lineHeight.relaxed,
  },
}); 