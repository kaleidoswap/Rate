import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * KaleidoSwap kaleidoscope "K" pictogram — the canonical mark. Mirrors the
 * extension's /kaleidoswap-pictogram.svg (the logo on its Welcome-back screen):
 * violet outer wedges, teal right wedges, a bright-mint center diamond.
 */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <Svg width={size} height={size} viewBox="0 0 412 412" fill="none">
    <Path d="M137.306 411.865H0.000244141L68.6795 343.29L137.306 411.865Z" fill="#6F32FF" />
    <Path d="M0 0H137.306L68.6267 68.574L0 0Z" fill="#6F32FF" />
    <Path d="M137.148 274.559H274.455L411.708 411.866H274.401L137.148 274.559Z" fill="#17B581" />
    <Path
      d="M137.149 274.559L68.6274 205.933L137.201 137.306L274.455 137.411L205.776 206.038L274.456 274.559H137.149Z"
      fill="#15E99A"
    />
    <Path d="M274.479 0.104797H411.786L274.533 137.411H137.226L274.479 0.104797Z" fill="#17B581" />
  </Svg>
);

export default BrandMark;
