// screens/PairDesktopScreen.tsx
//
// Scan a KaleidoMind pairing QR from the desktop-app (route /mind/pair).
// On success, saves the desktop's public key + metadata via PairingService.
//
// Pattern mirrors QRScannerScreen.tsx (camera permission flow + CameraView).

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import {
  PairingError,
  PairingService,
  parsePairingPayload,
  type PairingPayload,
} from '../services/PairingService';
import QVACService from '../services/QVACService';
import ToastService from '../services/ToastService';

const { width } = Dimensions.get('window');
const FRAME = Math.min(width * 0.7, 320);

interface Props {
  navigation: any;
}

type Stage =
  | { kind: 'scanning' }
  | { kind: 'confirming'; payload: PairingPayload }
  | { kind: 'paired'; name: string }
  | { kind: 'error'; message: string };

export default function PairDesktopScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'scanning' });
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Camera permission
  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission, requestPermission]);

  // Scan-line animation
  useEffect(() => {
    if (stage.kind !== 'scanning') return;
    scanLineAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.bezier(0.4, 0.0, 0.6, 1.0),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [stage.kind, scanLineAnim]);

  const handleScan = ({ data }: { data: string }) => {
    if (stage.kind !== 'scanning') return;
    try {
      const payload = parsePairingPayload(data);
      setStage({ kind: 'confirming', payload });
    } catch (e) {
      const msg = e instanceof PairingError ? e.message : 'Could not read QR.';
      setStage({ kind: 'error', message: msg });
      setTimeout(() => setStage({ kind: 'scanning' }), 2200);
    }
  };

  const confirmPair = async (payload: PairingPayload) => {
    try {
      const saved = await PairingService.save(payload);

      // Actually enable delegation in the QVAC engine. The singleton updates
      // its in-memory config synchronously, so the chat screen reads the new
      // provider as soon as it regains focus. The model reload runs in the
      // background — we don't block the UI on it.
      void QVACService.getInstance()
        .setDelegate({ enabled: true, providerPublicKey: payload.publicKey })
        .catch(() => {});

      ToastService.getInstance().success(`Connected to ${saved.name}`);
      setStage({ kind: 'paired', name: saved.name });
      setTimeout(() => navigation.goBack(), 1400);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save pairing.';
      setStage({ kind: 'error', message: msg });
    }
  };

  // ── Render permission states ──────────────────────────────────────
  if (!permission) {
    return <SafeAreaView style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionView}>
          <Ionicons name="camera-outline" size={56} color={theme.colors.text.secondary} />
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionBody}>
            To pair with your desktop, KaleidoSwap needs to read the QR code shown by the
            desktop app.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnLabel}>Allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryLink}>Not now</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render scanning ───────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={flash}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={stage.kind === 'scanning' ? handleScan : undefined}
      />

      {/* Mask */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <SafeAreaView style={styles.overlay}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Connect to desktop</Text>
            <View pointerEvents="auto">
              <TouchableOpacity
                onPress={() => setFlash((v) => !v)}
                style={styles.iconBtn}
              >
                <Ionicons
                  name={flash ? 'flash' : 'flash-outline'}
                  size={22}
                  color="#fff"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Frame */}
          <View style={styles.frameContainer}>
            <View style={[styles.frame, { width: FRAME, height: FRAME }]}>
              {/* Corners */}
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />

              {/* Scan line */}
              {stage.kind === 'scanning' && (
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [
                        {
                          translateY: scanLineAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, FRAME - 2],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              )}
            </View>
          </View>

          {/* Bottom prompt */}
          <View style={styles.bottomBar}>
            <Text style={styles.subtitle}>
              {stage.kind === 'scanning'
                ? 'Aim at the QR shown in desktop-app → /mind/pair'
                : ''}
            </Text>
          </View>
        </SafeAreaView>
      </View>

      {/* Confirmation card */}
      {stage.kind === 'confirming' && (
        <View pointerEvents="box-none" style={styles.modalRoot}>
          <View style={styles.card}>
            <Ionicons name="hardware-chip-outline" size={36} color={theme.colors.primary[500]} />
            <Text style={styles.cardTitle}>Pair with this device?</Text>
            <Text style={styles.cardName}>{stage.payload.name}</Text>
            <Text style={styles.cardMeta}>{stage.payload.model}</Text>
            <Text style={styles.cardKey} numberOfLines={1}>
              {stage.payload.publicKey.slice(0, 12)}…{stage.payload.publicKey.slice(-6)}
            </Text>

            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.cardBtn, styles.cardBtnSecondary]}
                onPress={() => setStage({ kind: 'scanning' })}
              >
                <Text style={styles.cardBtnSecondaryLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cardBtn, styles.cardBtnPrimary]}
                onPress={() => confirmPair(stage.payload)}
              >
                <Text style={styles.cardBtnPrimaryLabel}>Pair</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Result toasts */}
      {stage.kind === 'paired' && (
        <View pointerEvents="none" style={styles.modalRoot}>
          <View style={[styles.card, styles.cardSuccess]}>
            <Ionicons name="checkmark-circle" size={42} color="#15E99A" />
            <Text style={styles.cardTitle}>Connected</Text>
            <Text style={styles.cardName}>{stage.name}</Text>
          </View>
        </View>
      )}

      {stage.kind === 'error' && (
        <View pointerEvents="none" style={styles.modalRoot}>
          <View style={[styles.card, styles.cardError]}>
            <Ionicons name="alert-circle" size={42} color="#F87171" />
            <Text style={styles.cardTitle}>Pairing failed</Text>
            <Text style={styles.cardMeta}>{stage.message}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: { flex: 1, justifyContent: 'space-between' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },

  frameContainer: { alignItems: 'center', justifyContent: 'center' },
  frame: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#15E99A',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 16 },

  scanLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: '#15E99A',
    shadowColor: '#15E99A',
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },

  bottomBar: { paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center' },
  subtitle: { color: '#fff', fontSize: 14, textAlign: 'center', opacity: 0.85 },

  // Permission screen
  permissionView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permissionTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 16 },
  permissionBody: {
    color: '#9A9A94',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 28,
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: '#15E99A',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnLabel: { color: '#0D1813', fontWeight: '700' },
  secondaryLink: { color: '#9A9A94', marginTop: 18 },

  // Confirmation/result cards
  modalRoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#111110',
    borderColor: '#3D3D3A',
    borderWidth: 1,
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
  },
  cardSuccess: { borderColor: '#15E99A' },
  cardError: { borderColor: '#F87171' },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 12 },
  cardName: { color: '#fff', fontSize: 16, marginTop: 6, fontWeight: '600' },
  cardMeta: { color: '#9A9A94', fontSize: 13, marginTop: 4, textAlign: 'center' },
  cardKey: { color: '#15E99A', fontFamily: 'Courier', fontSize: 12, marginTop: 10 },
  cardActions: { flexDirection: 'row', gap: 12, marginTop: 18, width: '100%' },
  cardBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  cardBtnPrimary: { backgroundColor: '#15E99A' },
  cardBtnPrimaryLabel: { color: '#0D1813', fontWeight: '700' },
  cardBtnSecondary: { borderWidth: 1, borderColor: '#3D3D3A' },
  cardBtnSecondaryLabel: { color: '#fff' },
});
