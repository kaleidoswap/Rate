// components/DepositSuccessOverlay.tsx
//
// Full-screen "Deposit received!" confirmation, the React Native counterpart of
// rate-extension's DepositSuccessScreen. A spring-scaled checkmark with an
// expanding ring gives the same celebratory beat the extension shows when an
// incoming deposit is detected.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { Button } from './';

interface Props {
  visible: boolean;
  ticker: string;
  network?: string;
  amountLabel?: string; // optional "0.001 BTC" style summary
  onDone: () => void;
}

export default function DepositSuccessOverlay({ visible, ticker, network, amountLabel, onDone }: Props) {
  const scale = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      scale.setValue(0);
      ring.setValue(0);
      fade.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.8] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <Animated.View style={[styles.overlay, { opacity: fade }]} pointerEvents="auto">
      <View style={styles.card}>
        <View style={styles.badgeWrap}>
          <Animated.View style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
          <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
            <Ionicons name="checkmark" size={48} color="#FFFFFF" />
          </Animated.View>
        </View>

        <Text style={styles.title}>Deposit received!</Text>
        <Text style={styles.subtitle}>
          {amountLabel ? `${amountLabel}` : `Your ${ticker} arrived`}
          {network ? ` · ${network}` : ''}
        </Text>

        <Button title="Done" variant="primary" fullWidth onPress={onDone} style={styles.button} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  card: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
    margin: theme.spacing[5],
    width: '88%',
    alignItems: 'center',
  },
  badgeWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[5],
  },
  ring: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.success[500],
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.success[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[6],
    textAlign: 'center',
  },
  button: {
    width: '100%',
  },
});
