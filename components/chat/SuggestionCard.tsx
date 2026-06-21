// components/chat/SuggestionCard.tsx
//
// Thin adapter over the shared kaleido-ui/native SuggestionTile: maps Rate's
// Ionicons-based API onto the design-system tile (render-fn glyph + flat accent
// chip) so the chat empty state shares one tile shape with the web assistant.
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { SuggestionTile } from '@kaleidorg/kaleido-ui/native';
import type { ColorGradient } from '../../theme';

export interface SuggestionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** First stop is used as the flat icon-chip accent. */
  gradient: ColorGradient;
  onPress: () => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({ icon, title, subtitle, gradient, onPress }) => (
  <SuggestionTile
    title={title}
    subtitle={subtitle}
    accent={gradient[0]}
    onPress={onPress}
    icon={(color, size) => <Ionicons name={icon} size={size} color={color} />}
  />
);

export default SuggestionCard;
