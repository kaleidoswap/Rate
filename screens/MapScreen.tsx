// screens/MapScreen.tsx
import React from 'react';
import {
  View,
  StyleSheet,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';
import { MainHeader } from '../components';

interface Props {
  navigation: any;
}

export default function MapScreen({ navigation }: Props) {

  return (
    <View style={styles.container}>
      <MainHeader
        title="Bitcoin Map"
        subtitle="Discover Bitcoin-accepting venues worldwide"
        icon="map"
      />

      {/* Map Container */}
      <View style={styles.mapContainer}>
        <WebView
          source={{ uri: 'https://btcmap.org/map#16/46.00607/8.95201' }}
          style={styles.webview}
          startInLoadingState={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={Platform.OS === 'ios'}
          allowsFullscreenVideo={true}
          scrollEnabled={true}
          bounces={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },

  mapContainer: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },

  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
}); 