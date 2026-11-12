// screens/SecuritySetupScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  StatusBar,
  Alert,
  Platform,
  Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { theme } from '../theme';
import { Button, ScreenHeader } from '../components';
import SecurityService from '../services/SecurityService';

interface Props {
  navigation: any;
  route: {
    params?: {
      walletId?: number;
      isInitialSetup?: boolean;
      /** From Settings: set or change the PIN, or turn it off. Both need the current PIN or biometrics when a PIN exists. */
      mode?: SecurityMode;
    };
  };
}

export type SecurityMode = 'setup' | 'pin' | 'disablePin';
type SecurityStep = 'loading' | 'currentPin' | 'options' | 'pin' | 'confirmPin' | 'biometric' ;

export default function SecuritySetupScreen({ navigation, route }: Props) {
  const { isInitialSetup = false, mode = 'setup' } = route.params || {};
  const fromSettings = mode !== 'setup';

  const [step, setStep] = useState<SecurityStep>(fromSettings ? 'loading' : 'options');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [currentPinError, setCurrentPinError] = useState<string | null>(null);
  const [biometricUnlock, setBiometricUnlock] = useState(false);
  const verifyingCurrent = useRef(false);
  const [enablePin, setEnablePin] = useState(fromSettings);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face' | 'iris' | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

  useEffect(() => {
    if (!fromSettings) return;
    SecurityService.getInstance().getSecuritySettings().then((s) => {
      setBiometricUnlock(s.biometricEnabled && s.biometricType !== null);
      if (s.pinEnabled) setStep('currentPin');
      else if (mode === 'pin') setStep('pin');
      else navigation.goBack();
    }).catch(() => {
      Alert.alert('Security unavailable', 'Could not read your lock settings. Please try again.');
      navigation.goBack();
    });
  }, [fromSettings, mode, navigation]);

  const afterCurrentPinVerified = async () => {
    setCurrentPin('');
    setCurrentPinError(null);
    if (mode === 'pin') {
      animateTransition('pin');
      return;
    }
    if (await SecurityService.getInstance().removePin()) navigation.goBack();
    else Alert.alert('Error', 'Could not turn off the PIN. Please try again.');
  };

  const submitCurrentPin = async (candidate: string) => {
    if (verifyingCurrent.current) return;
    verifyingCurrent.current = true;
    try {
      const security = SecurityService.getInstance();
      if (await security.verifyPin(candidate)) {
        await afterCurrentPinVerified();
        return;
      }
      shakeError();
      const until = await security.getPinLockedUntil();
      setCurrentPinError(until > Date.now()
        ? `Too many attempts. Try again in ${Math.ceil((until - Date.now()) / 1000)}s`
        : 'Incorrect PIN');
      setCurrentPin('');
    } finally {
      verifyingCurrent.current = false;
    }
  };

  const confirmWithBiometric = async () => {
    const security = SecurityService.getInstance();
    if (await security.authenticateWithBiometric('Confirm it’s you', { allowDeviceFallback: false })) {
      await security.resetPinFailures();
      await afterCurrentPinVerified();
    }
  };

  const checkBiometricAvailability = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    
    if (compatible && enrolled) {
      setBiometricAvailable(true);
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        setBiometricType('face');
      } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        setBiometricType('fingerprint');
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        setBiometricType('iris');
      }
    }
  };

  const animateTransition = (nextStep: SecurityStep) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setStep(nextStep);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  };

  const shakeError = () => {
    Vibration.vibrate(100);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const animateComplete = () => {
    scaleAnim.setValue(0);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const handlePinPress = (digit: string) => {
    if (step === 'currentPin') {
      if (verifyingCurrent.current || currentPin.length >= 6) return;
      const next = currentPin + digit;
      setCurrentPin(next);
      setCurrentPinError(null);
      if (next.length === 6) submitCurrentPin(next);
    } else if (step === 'pin') {
      if (pin.length < 6) {
        const newPin = pin + digit;
        setPin(newPin);
        if (newPin.length === 6) {
          setTimeout(() => animateTransition('confirmPin'), 200);
        }
      }
    } else if (step === 'confirmPin') {
      if (confirmPin.length < 6) {
        const newConfirmPin = confirmPin + digit;
        setConfirmPin(newConfirmPin);
        if (newConfirmPin.length === 6) {
          if (newConfirmPin === pin) {
            // PIN matches!
            if (enableBiometric && biometricAvailable) {
              setTimeout(() => animateTransition('biometric'), 200);
            } else {
              handleSaveAndComplete();
            }
          } else {
            shakeError();
            setTimeout(() => {
              setConfirmPin('');
              Alert.alert('PINs Don\'t Match', 'Please try again.');
            }, 200);
          }
        }
      }
    }
  };

  const handleBackspace = () => {
    if (step === 'currentPin') {
      setCurrentPin(currentPin.slice(0, -1));
    } else if (step === 'pin') {
      setPin(pin.slice(0, -1));
    } else if (step === 'confirmPin') {
      setConfirmPin(confirmPin.slice(0, -1));
    }
  };

  const [securityBusy, setSecurityBusy] = useState(false);
  const biometricBusyRef = useRef(false);
  const handleEnableBiometric = async () => {
    if (biometricBusyRef.current) return;
    biometricBusyRef.current = true; setSecurityBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable ' + getBiometricLabel(),
        disableDeviceFallback: true,
      });
      if (result.success) await handleSaveAndComplete(true);
    } catch {
      Alert.alert('Security unavailable', 'Try again or use a PIN.');
    } finally { biometricBusyRef.current = false; setSecurityBusy(false); }
  };

  const handleSaveAndComplete = async (authenticatedBiometric = false) => {
    try {
      const securityService = SecurityService.getInstance();
      
      // Save PIN if enabled
      if (enablePin && pin) {
        const pinSaved = await securityService.savePin(pin);
        if (!pinSaved) {
          Alert.alert('Error', 'Failed to save PIN. Please try again.');
          return;
        }
      }
      
      // Save biometric preference if enabled
      if (authenticatedBiometric) {
        const biometricSaved = await securityService.setBiometricEnabled(true);
        if (!biometricSaved) {
          Alert.alert('Security unavailable', 'Could not save Face ID. Please try again.');
          return;
        }
      }
      
      console.log('Security settings saved successfully');
      if (fromSettings) {
        navigation.goBack();
        return;
      }
      if (isInitialSetup) { navigation.replace('OnboardingProfile'); return; }
      
      animateComplete();
    } catch (error) {
      console.error('Error saving security settings:', error);
      Alert.alert('Error', 'Failed to save security settings. Please try again.');
    }
  };

  const handleBack = () => {
    if (fromSettings && (step === 'loading' || step === 'currentPin' || step === 'pin')) {
      navigation.goBack();
    } else if (step === 'pin') {
      animateTransition('options');
      setPin('');
    } else if (step === 'confirmPin') {
      animateTransition('pin');
      setPin('');
      setConfirmPin('');
    } else if (step === 'biometric') {
      handleSaveAndComplete(); // Skip biometric
    } else if (step === 'options') {
      if (isInitialSetup) {
        navigation.replace('OnboardingProfile');
      } else {
        navigation.goBack();
      }
    }
  };

  const getBiometricIcon = () => {
    switch (biometricType) {
      case 'face':
        return 'scan-outline';
      case 'fingerprint':
        return 'finger-print';
      case 'iris':
        return 'eye-outline';
      default:
        return 'finger-print';
    }
  };

  const getBiometricLabel = () => {
    switch (biometricType) {
      case 'face':
        return 'Face ID';
      case 'fingerprint':
        return 'Fingerprint';
      case 'iris':
        return 'Iris Scan';
      default:
        return 'Biometric';
    }
  };

  const renderPinDots = (currentPin: string) => (
    <View style={styles.pinDotsContainer}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.pinDot,
            currentPin.length > i && styles.pinDotFilled,
            { transform: [{ translateX: shakeAnim }] }
          ]}
        />
      ))}
    </View>
  );

  const renderNumpad = () => (
    <View style={styles.numpad}>
      {[
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        [step === 'currentPin' && biometricUnlock ? 'bio' : '', '0', 'delete'],
      ].map((row, rowIndex) => (
        <View key={rowIndex} style={styles.numpadRow}>
          {row.map((key, keyIndex) => (
            <TouchableOpacity
              key={keyIndex}
              style={[
                styles.numpadKey,
                (key === '' || key === 'bio') && styles.numpadKeyEmpty,
              ]}
              accessibilityRole="button"
              accessibilityLabel={key === 'bio' ? `Use ${getBiometricLabel()}` : key === 'delete' ? 'Delete digit' : key}
              onPress={() => {
                if (key === 'delete') {
                  handleBackspace();
                } else if (key === 'bio') {
                  confirmWithBiometric();
                } else if (key !== '') {
                  handlePinPress(key);
                }
              }}
              disabled={key === ''}
              activeOpacity={0.6}
            >
              {key === 'delete' ? (
                <Ionicons name="backspace-outline" size={28} color={theme.colors.text.primary} />
              ) : key === 'bio' ? (
                <Ionicons name={getBiometricIcon()} size={28} color={theme.colors.text.primary} />
              ) : (
                <Text style={styles.numpadKeyText}>{key}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );

  const renderOptionsStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.optionsHeader}>
        <Ionicons name="shield-checkmark" size={48} color={theme.colors.primary[500]} />
        <Text style={styles.stepTitle}>Protect your wallet</Text>
        <Text style={styles.stepDescription}>Choose how to unlock it.</Text>
      </View>
      {biometricAvailable && <Button title={`Enable ${getBiometricLabel()}`} loading={securityBusy} disabled={securityBusy} onPress={handleEnableBiometric} />}
      <Button title="Use a PIN" variant={biometricAvailable ? 'secondary' : 'primary'} disabled={securityBusy} onPress={() => { setEnablePin(true); animateTransition('pin'); }} />
      <Button title="Not now" variant="ghost" disabled={securityBusy} onPress={() => navigation.replace('OnboardingProfile')} />
    </View>
  );

  const renderCurrentPinStep = () => (
    <View style={styles.pinStepContent}>
      <Text style={styles.pinTitle}>Enter current PIN</Text>
      <Text style={styles.pinSubtitle}>
        {currentPinError ?? (mode === 'pin' ? 'Confirm it’s you before changing your PIN' : 'Confirm it’s you before turning off your PIN')}
      </Text>
      {renderPinDots(currentPin)}
      {renderNumpad()}
    </View>
  );

  const renderPinStep = () => (
    <View style={styles.pinStepContent}>
      <Text style={styles.pinTitle}>{fromSettings ? 'New PIN' : 'Create PIN'}</Text>
      <Text style={styles.pinSubtitle}>Enter a 6-digit PIN code</Text>
      {renderPinDots(pin)}
      {renderNumpad()}
    </View>
  );

  const renderConfirmPinStep = () => (
    <View style={styles.pinStepContent}>
      <Text style={styles.pinTitle}>Confirm PIN</Text>
      <Text style={styles.pinSubtitle}>Re-enter your PIN to confirm</Text>
      {renderPinDots(confirmPin)}
      {renderNumpad()}
    </View>
  );

  const renderBiometricStep = () => (
    <View style={styles.biometricContent}>
      <View style={styles.biometricIconContainer}>
        <Ionicons name={getBiometricIcon()} size={64} color={theme.colors.primary[500]} />
      </View>
      <Text style={styles.biometricTitle}>Enable {getBiometricLabel()}</Text>
      <Text style={styles.biometricSubtitle}>
        Use {getBiometricLabel().toLowerCase()} for faster and more secure access to your wallet.
      </Text>
      
      <Button
        title={`Enable ${getBiometricLabel()}`}
        onPress={handleEnableBiometric}
        style={styles.biometricButton}
      />
      
      <TouchableOpacity style={styles.skipLink} onPress={() => void handleSaveAndComplete()}>
        <Text style={styles.skipLinkText}>Skip</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={mode === 'pin' ? 'Wallet PIN' : mode === 'disablePin' ? 'Turn off PIN' : 'Security Setup'}
        showBack={step !== 'loading'}
        onBack={handleBack}
      />

      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {step === 'currentPin' && renderCurrentPinStep()}
        {step === 'options' && renderOptionsStep()}
        {step === 'pin' && renderPinStep()}
        {step === 'confirmPin' && renderConfirmPinStep()}
        {step === 'biometric' && renderBiometricStep()}
              </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  headerGradient: {
    paddingBottom: theme.spacing[4],
  },
  safeArea: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: 'white',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    marginTop: -theme.spacing[4],
  },
  stepContent: {
    flex: 1,
    padding: theme.spacing[6],
  },
  optionsHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[8],
  },
  stepTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  stepDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: theme.spacing[2],
  },
  optionCardActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[50],
  },
  optionIconActive: {
    backgroundColor: theme.colors.primary[500],
  },
  optionCheckboxActive: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
  },
  optionsFooter: {
    marginTop: 'auto',
    gap: theme.spacing[3],
  },
  continueButton: {
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  skipLink: {
    alignItems: 'center',
    paddingVertical: theme.spacing[2],
  },
  skipLinkText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.tertiary,
    fontWeight: '500',
  },
  pinStepContent: {
    flex: 1,
    paddingTop: theme.spacing[10],
    alignItems: 'center',
  },
  pinTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  pinSubtitle: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[8],
  },
  pinDotsContainer: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[10],
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.gray[200],
  },
  pinDotFilled: {
    backgroundColor: theme.colors.primary[500],
  },
  numpad: {
    marginTop: 'auto',
    paddingBottom: Platform.OS === 'ios' ? theme.spacing[8] : theme.spacing[4],
  },
  numpadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  numpadKey: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: theme.spacing[3],
  },
  numpadKeyEmpty: {
    backgroundColor: 'transparent',
  },
  numpadKeyText: {
    fontSize: 28,
    fontWeight: '500',
    color: theme.colors.text.primary,
  },
  biometricContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[6],
  },
  biometricIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[6],
  },
  biometricTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  biometricSubtitle: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  biometricButton: {
    width: '100%',
    marginBottom: theme.spacing[3],
  },
  completeGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  completeSubtitle: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[6],
  },
  securitySummary: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    width: '100%',
    marginBottom: theme.spacing[8],
    gap: theme.spacing[2],
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  summaryText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  finishButton: {
    width: '100%',
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});


