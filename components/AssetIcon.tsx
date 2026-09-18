/**
 * AssetIcon — renders asset icons with protocol badge overlay.
 * Resolution order: bundled canonical icons → supplied logo → CDN → text placeholder.
 * The fallback is deterministic and offline-safe; no avatar service is used.
 */
import React, { useEffect, useState } from 'react';
import { View, Image, Text, StyleSheet, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { SparkIcon, ArkadeIcon, RgbIcon } from './ProtocolIcons';

const ICON_CDN_BASE = 'https://raw.githubusercontent.com/kaleidoswap/coinmarketcap-icons-cryptos/refs/heads/main/icons/';
const LOCAL_ASSET_ICONS: Record<string, ImageSourcePropType> = {
  BTC: require('../assets/icons/protocols/btc.png'),
};

const PROTOCOL_COLORS: Record<string, string> = {
  RGB: theme.colors.networks.unified,
  SPARK: theme.colors.networks.spark,
  ARKADE: theme.colors.networks.arkade,
};

const PROTOCOL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  RGB: 'flash',
  SPARK: 'sparkles',
  ARKADE: 'shield-checkmark',
};

// Colors for text placeholder backgrounds. ETH/USDT/USDC are crypto-brand
// colors with no token equivalent; the rest map to design tokens.
const ASSET_COLORS: Record<string, string> = {
  BTC: theme.colors.networks.bitcoin,
  ETH: '#627EEA',
  USDT: '#26A17B',
  USDC: '#2775CA',
  USDB: theme.colors.accent[500],
  DEFAULT: theme.colors.gray[500],
};

/** The brand color an asset's icon uses — so other surfaces (e.g. the asset
 *  card gradient) can tint to match the icon rather than the protocol. */
export function assetIconColor(ticker?: string): string {
  return ASSET_COLORS[(ticker ?? '').toUpperCase().trim()] ?? ASSET_COLORS.DEFAULT;
}

function getCdnUrl(ticker: string): string {
  const normalized = ticker.toUpperCase().trim();
  if (!/^[A-Z0-9-]{1,12}$/.test(normalized)) return '';
  return `${ICON_CDN_BASE}${normalized.toLowerCase()}.png`;
}

/** The actual image URI the icon renders (asset logo → CDN by ticker). Empty
 *  string when neither resolves. Shared so other surfaces (e.g. the gradient
 *  average-color sampler) read the exact same image the icon shows. */
export function resolveAssetIconUri(ticker: string, logoUri?: string): string {
  return logoUri || getCdnUrl(ticker);
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

  const localIcon = LOCAL_ASSET_ICONS[ticker.toUpperCase().trim()];
  const iconUri = logoUri || getCdnUrl(ticker);
  const bgColor = ASSET_COLORS[ticker.toUpperCase()] || ASSET_COLORS.DEFAULT;
  const badgeSize = Math.round(size * 0.4);

  useEffect(() => setImageError(false), [ticker, logoUri]);

  const renderImage = () => {
    if (localIcon) {
      return (
        <Image
          source={localIcon}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="contain"
        />
      );
    }
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
