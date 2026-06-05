import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, G } from 'react-native-svg';

export interface BrandMarkProps {
  /** Rendered width/height in px (the mark is square). */
  size?: number;
  /** Optional opacity passed to the whole mark. */
  opacity?: number;
}

/**
 * KaleidoSwap kaleidoscope-"K" mark, rendered as faceted triangles with the
 * brand gradients (bright inner chevron, deep green arms, purple accents).
 *
 * Single source of truth lives in assets/brand/mark.svg — keep them in sync.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ size = 96, opacity = 1 }) => (
  <Svg width={size} height={size} viewBox="0 0 210 210" opacity={opacity}>
    <Defs>
      <LinearGradient id="gGreenA" x1="35" y1="70" x2="140" y2="172" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#3BFF8C" />
        <Stop offset="1" stopColor="#15E99A" />
      </LinearGradient>
      <LinearGradient id="gGreenB" x1="138" y1="0" x2="207" y2="207" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#1ED68F" />
        <Stop offset="1" stopColor="#0E9C68" />
      </LinearGradient>
      <LinearGradient id="gPurple" x1="0" y1="0" x2="70" y2="207" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#9B6BFF" />
        <Stop offset="1" stopColor="#6F32FF" />
      </LinearGradient>
    </Defs>
    <G>
      {/* purple accent corners */}
      <Path d="M69.7141 207.3H0.908203L35.3243 172.936L69.7141 207.3Z" fill="url(#gPurple)" />
      <Path d="M0.908203 0.908325H69.7141L35.298 35.2718L0.908203 0.908325Z" fill="url(#gPurple)" />
      {/* deep green arms */}
      <Path d="M138.441 0.96106V69.767L104.078 35.3508L138.441 0.96106Z" fill="url(#gGreenB)" />
      <Path d="M138.415 138.547V207.352L104.051 172.936L138.415 138.547Z" fill="url(#gGreenB)" />
      <Path d="M138.441 69.7406V0.96106L172.804 35.3772L138.441 69.767V69.7406Z" fill="url(#gGreenB)" />
      <Path d="M138.467 207.379V138.573L172.831 172.989L138.467 207.379Z" fill="url(#gGreenB)" />
      <Path d="M207.22 207.3H138.415L172.831 172.936L207.22 207.3Z" fill="url(#gGreenB)" />
      <Path d="M138.415 0.987427H207.22L172.804 35.3509L138.415 0.987427Z" fill="url(#gGreenB)" />
      <Path d="M138.467 69.7143H69.6614L104.078 35.3508L138.467 69.7143Z" fill="url(#gGreenB)" />
      <Path d="M69.635 138.494H138.441L104.025 172.857L69.635 138.494Z" fill="url(#gGreenB)" />
      {/* bright inner chevron */}
      <Path d="M69.6614 138.494V69.6879L104.025 104.104L69.6614 138.494Z" fill="url(#gGreenA)" />
      <Path d="M69.6615 69.7142V138.52L35.2981 104.104L69.6615 69.7142Z" fill="url(#gGreenA)" />
      <Path d="M138.415 138.494H69.635L104.025 104.157L138.388 138.494H138.415Z" fill="url(#gGreenA)" />
      <Path d="M138.415 69.7142L104.051 104.051L69.6614 69.7142H138.441H138.415Z" fill="url(#gGreenA)" />
    </G>
  </Svg>
);

export default BrandMark;
