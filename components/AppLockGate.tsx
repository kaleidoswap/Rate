// components/AppLockGate.tsx
//
// Enforces the PIN / biometric lock configured in SecuritySetupScreen. Rendered
// once at the app root: it covers the whole UI on cold start and again after
// the app has been in the background for longer than `settings.autoLockTimeout`
// minutes. It renders inside a <Modal> so it also covers native-stack modal
// screens that may be open when the app resumes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import SecurityService from '../services/SecurityService';
import { setAppUnlocked } from '../services/appLockState';
import { useAppSelector } from '../store/hooks';

const PIN_LENGTH = 6;
// Wrong-PIN cooldowns are counted and enforced by SecurityService, which keeps
// them in SecureStore; this gate only shows the countdown.

type LockMode = 'checking' | 'locked' | 'unlocked' | 'error';

interface LockMethods {
  pin: boolean;
  biometric: boolean;
}

/**
 * Which unlock methods are actually usable right now. Biometric only counts
 * when the user enabled it AND the device still has enrolled hardware.
 * A configured but unavailable method must never silently disable the lock.
 */
async function resolveLockMethods(): Promise<LockMethods> {
  const settings = await SecurityService.getInstance().getSecuritySettings();
  if (settings.biometricEnabled && !settings.biometricType && !settings.pinEnabled) {
    throw new Error('Biometric authentication is unavailable');
  }
  return {
    pin: settings.pinEnabled,
    biometric: settings.biometricEnabled && settings.biometricType !== null,
  };
}

export function AppLockGate() {
  const autoLockTimeout = useAppSelector((s) => s.settings?.autoLockTimeout ?? 5);
  const [mode, setMode] = useState<LockMode>('checking');
  // Publish the lock state for services (e.g. NWC payment approval).
  useEffect(() => {
    setAppUnlocked(mode === 'unlocked');
  }, [mode]);
  const [methods, setMethods] = useState<LockMethods>({ pin: false, biometric: false });
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const backgroundedAt = useRef<number | null>(null);
  const verifying = useRef(false);

  const methodsRef = useRef<LockMethods>({ pin: false, biometric: false });
  const promptBiometric = useCallback(async () => {
    // With a wallet PIN set, a failed biometric falls back to that PIN, never to
    // the phone's passcode; biometric-only wallets keep the passcode as recovery.
    const ok = await SecurityService.getInstance().authenticateWithBiometric(
      'Unlock your wallet',
      { allowDeviceFallback: !methodsRef.current.pin },
    );
    if (ok) {
      await SecurityService.getInstance().resetPinFailures();
      setPin('');
      setError(null);
      setMode('unlocked');
    }
  }, []);

  // Decide whether to lock. Called on cold start and when resuming after the
  // auto-lock timeout. Only a successful check with no configured lock
  // may uncover the app without authentication.
  const lock = useCallback(async () => {
    // Cover the UI straight away; it only uncovers once we know no lock applies.
    setMode((m) => (m === 'locked' ? m : 'checking'));
    try {
      const m = await resolveLockMethods();
      methodsRef.current = m;
      setMethods(m);
      if (!m.pin && !m.biometric) {
        setMode('unlocked');
        return;
      }
      setPin('');
      setError(null);
      // A cooldown from before a restart still applies.
      const lockedUntil = await SecurityService.getInstance().getPinLockedUntil();
      setNow(Date.now());
      setCooldownUntil(lockedUntil);
      if (lockedUntil > Date.now()) setError('Too many attempts');
      setMode('locked');
      if (m.biometric) {
        promptBiometric();
      }
    } catch (e) {
      console.warn('App lock check failed:', e instanceof Error ? e.message : String(e));
      setError('Unable to check wallet security. Unlock your device and try again.');
      setMode('error');
    }
  }, [promptBiometric]);

  useEffect(() => {
    lock();
  }, [lock]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next === 'active' && backgroundedAt.current !== null) {
        const awayMs = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (awayMs >= autoLockTimeout * 60_000) {
          lock();
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [autoLockTimeout, lock]);

  // Tick once a second while a cooldown is running so the countdown updates.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const coolingDown = cooldownUntil > now;

  const submitPin = useCallback(async (candidate: string) => {
    if (verifying.current) return;
    verifying.current = true;
    try {
      const ok = await SecurityService.getInstance().verifyPin(candidate);
      if (ok) {
        setError(null);
        setMode('unlocked');
      } else {
        const until = await SecurityService.getInstance().getPinLockedUntil();
        if (until > Date.now()) {
          setNow(Date.now());
          setCooldownUntil(until);
          setError('Too many attempts');
        } else {
          setError('Incorrect PIN');
        }
      }
    } finally {
      setPin('');
      verifying.current = false;
    }
  }, []);

  const pressDigit = (digit: string) => {
    if (coolingDown || verifying.current || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    setError(null);
    if (next.length === PIN_LENGTH) {
      submitPin(next);
    }
  };

  if (mode === 'unlocked') return null;

  const cooldownSeconds = Math.ceil((cooldownUntil - now) / 1000);

  return (
    <Modal visible animationType="none" transparent={false} onRequestClose={() => {}}>
      <SafeAreaView style={styles.container}>
        {mode === 'error' && (
          <View style={styles.header}>
            <Text style={styles.title}>Wallet locked</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <TouchableOpacity style={styles.bioButton} accessibilityRole="button" accessibilityLabel="Retry security check" onPress={lock}>
              <Text style={styles.bioButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        {mode === 'locked' && (
          <>
            <View style={styles.header}>
              <View style={styles.iconWrap}>
                <Ionicons name="lock-closed" size={32} color={theme.colors.primary[500]} />
              </View>
              <Text style={styles.title}>Wallet locked</Text>
              <Text style={styles.subtitle}>
                {coolingDown
                  ? `Try again in ${cooldownSeconds}s`
                  : methods.pin
                    ? 'Enter your PIN to unlock'
                    : 'Authenticate to unlock'}
              </Text>
              {error && !coolingDown && <Text style={styles.error}>{error}</Text>}
            </View>

            {methods.pin && (
              <>
                <View style={styles.dots}>
                  {Array.from({ length: PIN_LENGTH }, (_, i) => (
                    <View key={i} style={[styles.dot, pin.length > i && styles.dotFilled]} />
                  ))}
                </View>
                <View style={styles.numpad}>
                  {[
                    ['1', '2', '3'],
                    ['4', '5', '6'],
                    ['7', '8', '9'],
                    [methods.biometric ? 'bio' : '', '0', 'delete'],
                  ].map((row, r) => (
                    <View key={r} style={styles.numpadRow}>
                      {row.map((key, k) => (
                        <TouchableOpacity
                          key={k}
                          style={[styles.key, (key === '' || key === 'bio' || key === 'delete') && styles.keyBare]}
                          disabled={key === '' || coolingDown}
                          activeOpacity={0.6}
                          accessibilityRole="button"
                          accessibilityLabel={
                            key === 'bio' ? 'Unlock with biometrics' : key === 'delete' ? 'Delete digit' : key
                          }
                          onPress={() => {
                            if (key === 'delete') setPin((p) => p.slice(0, -1));
                            else if (key === 'bio') promptBiometric();
                            else if (key !== '') pressDigit(key);
                          }}
                        >
                          {key === 'delete' ? (
                            <Ionicons name="backspace-outline" size={28} color={theme.colors.text.primary} />
                          ) : key === 'bio' ? (
                            <Ionicons name="finger-print" size={28} color={theme.colors.text.primary} />
                          ) : (
                            <Text style={styles.keyText}>{key}</Text>
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </View>
              </>
            )}

            {!methods.pin && methods.biometric && (
              <TouchableOpacity
                style={styles.bioButton}
                onPress={promptBiometric}
                accessibilityRole="button"
                accessibilityLabel="Unlock with biometrics"
              >
                <Ionicons name="finger-print" size={28} color={theme.colors.text.inverse} />
                <Text style={styles.bioButtonText}>Unlock</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    alignItems: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  header: {
    alignItems: 'center',
    marginTop: theme.spacing[16],
    marginBottom: theme.spacing[10],
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[5],
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  subtitle: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  error: {
    marginTop: theme.spacing[3],
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[500],
  },
  dots: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[10],
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.gray[200],
  },
  dotFilled: {
    backgroundColor: theme.colors.primary[500],
  },
  numpad: {
    marginTop: 'auto',
    paddingBottom: theme.spacing[6],
  },
  numpadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: theme.spacing[3],
  },
  keyBare: {
    backgroundColor: 'transparent',
  },
  keyText: {
    fontSize: theme.typography.fontSize['3xl'],
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.primary,
  },
  bioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.full,
  },
  bioButtonText: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.inverse,
  },
});

export default AppLockGate;
