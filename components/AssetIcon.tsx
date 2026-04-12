/**
 * AssetIcon — renders asset icons with protocol badge overlay.
 * Matches rate-extension pattern: local icons → CDN → DiceBear fallback → text placeholder.
 */
import React, { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SparkIcon, ArkadeIcon, RgbIcon } from './ProtocolIcons';

const ICON_CDN_BASE = 'https://raw.githubusercontent.com/kaleidoswap/coinmarketcap-icons-cryptos/refs/heads/main/icons/';
const DICEBEAR_BASE = 'https://api.dicebear.com/9.x/shapes/svg';

const PROTOCOL_COLORS: Record<string, string> = {
  RGB: '#2BEE79',
  SPARK: '#60A5FA',
  ARKADE: '#A855F7',
};

const PROTOCOL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  RGB: 'flash',
  SPARK: 'sparkles',
  ARKADE: 'shield-checkmark',
};

// Colors for text placeholder backgrounds
const ASSET_COLORS: Record<string, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  USDT: '#26A17B',
  USDC: '#2775CA',
  USDB: '#4290FF',
  DEFAULT: '#64748B',
};

function getCdnUrl(ticker: string): string {
  const normalized = ticker.toUpperCase().trim();
  if (!/^[A-Z0-9-]{1,12}$/.test(normalized)) return '';
  return `${ICON_CDN_BASE}${normalized.toLowerCase()}.png`;
}

function getFallbackUrl(ticker: string): string {
  return `${DICEBEAR_BASE}?seed=${encodeURIComponent(ticker)}&backgroundType=gradientLinear&radius=50`;
}

interface AssetIconProps {
  ticker: string;
  name?: string;
  logoUri?: string;
  protocol?: 'RGB' | 'SPARK' | 'ARKADE';
  size?: number;
  showBadge?: boolean;
}

export const AssetIcon: React.FC<AssetIconProps> = ({
  ticker,
  logoUri,
  protocol,
  size = 40,
  showBadge = true,
}) => {
  const [imageError, setImageError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  const iconUri = logoUri || getCdnUrl(ticker);
  const fallbackUri = getFallbackUrl(ticker);
  const bgColor = ASSET_COLORS[ticker.toUpperCase()] || ASSET_COLORS.DEFAULT;
  const badgeSize = Math.round(size * 0.4);

  const renderImage = () => {
    if (!imageError && iconUri) {
      return (
        <Image
          source={{ uri: iconUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setImageError(true)}
          resizeMode="contain"
        />
      );
    }

    if (!fallbackError) {
      return (
        <Image
          source={{ uri: fallbackUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFallbackError(true)}
          resizeMode="contain"
        />
      );
    }

    // Text placeholder
    return (
      <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}>
        <Text style={[styles.placeholderText, { fontSize: size * 0.4 }]}>
          {ticker.charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  };

  return (
    <View style={{ width: size, height: size }}>
      {renderImage()}

      {/* Protocol badge with SVG icon */}
      {showBadge && protocol && PROTOCOL_COLORS[protocol] && (
        <View style={[styles.badge, {
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeSize / 2,
          backgroundColor: PROTOCOL_COLORS[protocol],
          bottom: -2,
          right: -2,
        }]}>
          {protocol === 'SPARK' && <SparkIcon size={badgeSize * 0.6} color="#fff" />}
          {protocol === 'ARKADE' && <ArkadeIcon size={badgeSize * 0.6} color="#fff" />}
          {protocol === 'RGB' && <RgbIcon size={badgeSize * 0.6} color="#fff" />}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#fff',
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
});

export default AssetIcon;
