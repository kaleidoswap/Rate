/**
 * Protocol SVG icons — exact SVGs from rate-extension.
 */
import React from 'react';
import { Image } from 'react-native';
import Svg, { G, Path, Rect, Polygon, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme';

const RGB_LOGO = require('../assets/icons/protocols/rgb.png');

interface IconProps {
  size?: number;
  color?: string;
}

/** Spark asterisk — exact path from extension */
export const SparkIcon: React.FC<IconProps> = ({ size = 24, color = '#60A5FA' }) => (
  <Svg width={size} height={size} viewBox="0 0 135 128" fill="none">
    <Path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"
      fill={color}
    />
  </Svg>
);

/** Arkade grid shield — exact rects from extension */
export const ArkadeIcon: React.FC<IconProps> = ({ size = 24, color = '#A855F7' }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Rect width="1024" height="1024" rx="200" fill={color} />
    <Rect x="512" y="256" width="128" height="128" fill="white" />
    <Rect x="384" y="256" width="128" height="128" fill="white" />
    <Rect x="640" y="384" width="128" height="128" fill="white" />
    <Rect x="256" y="384" width="128" height="128" fill="white" />
    <Rect x="384" y="512" width="128" height="128" fill="white" />
    <Rect x="512" y="512" width="128" height="128" fill="white" />
    <Rect x="640" y="640" width="128" height="128" fill="white" />
    <Rect x="256" y="640" width="128" height="128" fill="white" />
    <Path d="M640 256L768 384H640V256Z" fill="white" />
    <Path d="M384 256L256 384H384V256Z" fill="white" />
  </Svg>
);

/** Lightning bolt */
export const LightningIcon: React.FC<IconProps> = ({ size = 24, color = '#FACC15' }) => (
  <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
    <Polygon
      points="357.016,284.718 127.381,512 218.95,282.398 97.907,212.514 202.824,33.17 327.203,104.979 246.056,220.655"
      fill={color}
    />
  </Svg>
);

/** Bitcoin circle with B */
export const BitcoinIcon: React.FC<IconProps> = ({ size = 24, color = '#F7931A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="11" fill={color} />
    <Path d="M14.5 10C14.5 8.9 13.6 8 12.5 8H10V12H12.5C13.6 12 14.5 11.1 14.5 10Z" fill="white" />
    <Path d="M12.5 12H10V16H12.5C13.6 16 14.5 15.1 14.5 14C14.5 12.9 13.6 12 12.5 12Z" fill="white" />
    <Path d="M11 6V8M13 6V8M11 16V18M13 16V18" stroke="white" strokeWidth="1.5" />
  </Svg>
);

/** RGB — the logo the extension uses (kaleido-ui protocolIcons). It's full colour, so `color` is ignored. */
export const RgbIcon: React.FC<IconProps> = ({ size = 24 }) => (
  <Image source={RGB_LOGO} style={{ width: size, height: size }} resizeMode="contain" />
);

/** On-chain (L1) — the extension's chain-link glyph (web-extension OnchainIcon). */
export const OnchainIcon: React.FC<IconProps> = ({ size = 24, color = theme.colors.networks.bitcoin }) => (
  <Svg width={size} height={size} viewBox="0 0 47.5 47.5" fill={color}>
    <G transform="matrix(1.25 0 0 -1.25 0 47.5)">
      <Path d="m16 28 6 6s6 6 12 0 0-12 0-12l-8-8s-6-6-12 0c-1.125 1.125-1.822 2.62-1.822 2.62l3.353 3.348S15.396 18.604 17 17c0 0 3-3 6 0l8 8s3 3 0 6-6 0-6 0l-3.729-3.729s-1.854 1.521-5.646.354L16 28Z" />
      <Path d="m21.845 10-6-6s-6-6-12 0 0 12 0 12l8 8s6 6 12 0c1.125-1.125 1.822-2.62 1.822-2.62l-3.353-3.349s.135 1.365-1.469 2.969c0 0-3 3-6 0l-8-8s-3-3 0-6 6 0 6 0l3.729 3.729s1.854-1.52 5.646-.354L21.845 10Z" />
    </G>
  </Svg>
);

/** USD — green coin with a white dollar sign (matches the brand USDt mark) */
export const UsdCoinIcon: React.FC<IconProps> = ({ size = 24, color = '#16A974' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* darker rim for a subtle coin depth */}
    <Circle cx="12" cy="12" r="11" fill={color} opacity={0.85} />
    <Circle cx="12" cy="11.4" r="9.6" fill={color} />
    <SvgText
      x="12"
      y="16.6"
      fill="#FFFFFF"
      fontSize="15"
      fontWeight="900"
      textAnchor="middle"
    >
      $
    </SvgText>
  </Svg>
);

export function getProtocolIcon(protocol: string): React.FC<IconProps> {
  switch (protocol.toUpperCase()) {
    case 'SPARK': return SparkIcon;
    case 'ARKADE': return ArkadeIcon;
    case 'RGB':
    case 'RLN': return RgbIcon;
    case 'BTC':
    case 'BITCOIN': return BitcoinIcon;
    case 'LIGHTNING':
    case 'LN': return LightningIcon;
    case 'ONCHAIN': return OnchainIcon;
    default: return RgbIcon;
  }
}
