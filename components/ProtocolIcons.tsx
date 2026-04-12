/**
 * Protocol SVG icons — exact SVGs from rate-extension.
 */
import React from 'react';
import Svg, { Path, Rect, Polygon, Circle } from 'react-native-svg';

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

/** RGB — simplified triangle logo (full SVG too complex for RN) */
export const RgbIcon: React.FC<IconProps> = ({ size = 24, color = '#2BEE79' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 2L2 20H22L12 2Z" fill={color} opacity={0.15} />
    <Path d="M12 2L2 20H22L12 2Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    <Path d="M12 8V14M12 16V17" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </Svg>
);

/** On-chain link icon */
export const OnchainIcon: React.FC<IconProps> = ({ size = 24, color = '#F7931A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
