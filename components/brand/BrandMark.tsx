import React from 'react';
import { View } from 'react-native';
import { BrandMark as CanonicalBrandMark } from '../BrandMark';

export interface BrandMarkProps {
  /** Rendered width/height in px (the mark is square). */
  size?: number;
  /** Optional opacity passed to the whole mark. */
  opacity?: number;
}

/**
 * Forwards to the single canonical KaleidoSwap mark (`components/BrandMark`,
 * which mirrors the extension's pictogram). This file used to hold a separate,
 * older gradient mark — keeping the logo in two places meant the loader/intro
 * silently showed the wrong one. Now there's a single source of truth.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ size = 96, opacity = 1 }) =>
  opacity === 1 ? (
    <CanonicalBrandMark size={size} />
  ) : (
    <View style={{ opacity }}>
      <CanonicalBrandMark size={size} />
    </View>
  );

export default BrandMark;
