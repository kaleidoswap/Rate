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
    };
  };
}

type SecurityStep = 'options' | 'pin' | 'confirmPin' | 'biometric' | 'complete';

export default function SecuritySetupScreen({ navigation, route }: Props) {
  const { isInitialSetup = false } = route.params || {};
  
  const [step, setStep] = useState<SecurityStep>('options');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [enablePin, setEnablePin] = useState(false);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'face' | 'iris' | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkBiometricAvailability();
  }, []);

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
    if (step === 'pin') {
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
    if (step === 'pin') {
      setPin(pin.slice(0, -1));
    } else if (step === 'confirmPin') {
      setConfirmPin(confirmPin.slice(0, -1));
    }
  };

  const handleEnableBiometric = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to enable biometric login',
        fallbackLabel: 'Use PIN instead',
        disableDeviceFallback: false,
      });

      if (result.success) {
        handleSaveAndComplete();
      } else {
        Alert.alert('Authentication Failed', 'Would you like to try again?', [
          { text: 'Skip', onPress: handleSaveAndComplete, style: 'cancel' },
          { text: 'Try Again', onPress: handleEnableBiometric },
        ]);
      }
    } catch (error) {
      handleSaveAndComplete();
    }
  };

  const handleSaveAndComplete = async () => {
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
      if (enableBiometric) {
        const biometricSaved = await securityService.setBiometricEnabled(true);
        if (!biometricSaved) {
          console.warn('Failed to save biometric preference');
          // Don't block on biometric save failure, continue anyway
        }
      }
      
      console.log('Security settings saved successfully');
      setStep('complete');
      animateComplete();
    } catch (error) {
      console.error('Error saving security settings:', error);
      Alert.alert('Error', 'Failed to save security settings. Please try again.');
    }
  };

  const handleBack = () => {
    if (step === 'pin') {
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
        navigation.replace('NostrSetup', { isInitialSetup: true });
      } else {
        navigation.goBack();
      }
    }
  };

  const handleStartSetup = () => {
    if (enablePin) {
      animateTransition('pin');
    } else if (enableBiometric && biometricAvailable) {
      animateTransition('biometric');
    } else {
      Alert.alert('Select an Option', 'Please enable at least one security method to continue, or skip this step.');
    }
  };

  const handleFinish = () => {
    if (isInitialSetup) {
      navigation.replace('NostrSetup', { isInitialSetup: true });
    } else {
      navigation.goBack();
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
        ['', '0', 'delete'],
      ].map((row, rowIndex) => (
        <View key={rowIndex} style={styles.numpadRow}>
          {row.map((key, keyIndex) => (
            <TouchableOpacity
              key={keyIndex}
              style={[
                styles.numpadKey,
                key === '' && styles.numpadKeyEmpty,
              ]}
              onPress={() => {
                if (key === 'delete') {
                  handleBackspace();
                } else if (key !== '') {
                  handlePinPress(key);
                }
              }}
              disabled={key === ''}
              activeOpacity={0.6}
            >
              {key === 'delete' ? (
                <Ionicons name="backspace-outline" size={28} color={theme.colors.text.primary} />
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
        <View style={styles.shieldIcon}>
          <Ionicons name="shield-checkmark" size={40} color={theme.colors.primary[500]} />
        </View>
        <Text style={styles.stepTitle}>Secure Your Wallet</Text>
        <Text style={styles.stepDescription}>
          Choose how you want to protect your wallet. You can enable both for maximum security.
        </Text>
      </View>

      <View style={styles.optionsContainer}>
        <TouchableOpacity
          style={[styles.optionCard, enablePin && styles.optionCardActive]}
          onPress={() => setEnablePin(!enablePin)}
          activeOpacity={0.7}
        >
          <View style={[styles.optionIcon, enablePin && styles.optionIconActive]}>
            <Ionicons name="keypad" size={28} color={enablePin ? 'white' : theme.colors.primary[500]} />
          </View>
          <View style={styles.optionTextContainer}>
            <Text style={styles.optionTitle}>PIN Code</Text>
            <Text style={styles.optionDesc}>6-digit code for quick access</Text>
          </View>
          <View style={[styles.optionCheckbox, enablePin && styles.optionCheckboxActive]}>
            {enablePin && <Ionicons name="checkmark" size={18} color="white" />}
          </View>
        </TouchableOpacity>

        {biometricAvailable && (
          <TouchableOpacity
            style={[styles.optionCard, enableBiometric && styles.optionCardActive]}
            onPress={() => setEnableBiometric(!enableBiometric)}
            activeOpacity={0.7}
          >
            <View style={[styles.optionIcon, enableBiometric && styles.optionIconActive]}>
              <Ionicons 
                name={getBiometricIcon()} 
                size={28} 
                color={enableBiometric ? 'white' : theme.colors.primary[500]} 
              />
            </View>
            <View style={styles.optionTextContainer}>
              <Text style={styles.optionTitle}>{getBiometricLabel()}</Text>
              <Text style={styles.optionDesc}>Quick unlock with biometrics</Text>
            </View>
            <View style={[styles.optionCheckbox, enableBiometric && styles.optionCheckboxActive]}>
              {enableBiometric && <Ionicons name="checkmark" size={18} color="white" />}
            </View>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.optionsFooter}>
        <Button
          title="Continue"
          onPress={handleStartSetup}
          disabled={!enablePin && !enableBiometric}
          style={styles.continueButton}
        />
        {isInitialSetup && (
          <TouchableOpacity style={styles.skipLink} onPress={() => navigation.replace('NostrSetup', { isInitialSetup: true })}>
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderPinStep = () => (
    <View style={styles.pinStepContent}>
      <Text style={styles.pinTitle}>Create PIN</Text>
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
      
      <TouchableOpacity style={styles.skipLink} onPress={handleSaveAndComplete}>
        <Text style={styles.skipLinkText}>Skip</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCompleteStep = () => (
    <View style={styles.completeContent}>
      <Animated.View style={[
        styles.completeIcon,
        { transform: [{ scale: scaleAnim }] }
      ]}>
        <LinearGradient
          colors={theme.colors.success.gradient || [theme.colors.success[500], theme.colors.success[500]]}
          style={styles.completeGradient}
        >
          <Ionicons name="checkmark" size={48} color="white" />
        </LinearGradient>
      </Animated.View>
      
      <Text style={styles.completeTitle}>Security Enabled!</Text>
      <Text style={styles.completeSubtitle}>
        Your wallet is now protected
        {enablePin && enableBiometric 
          ? ` with PIN and ${getBiometricLabel()}`
          : enablePin 
            ? ' with PIN'
            : ` with ${getBiometricLabel()}`
        }.
      </Text>

      <View style={styles.securitySummary}>
        {enablePin && (
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={20} color={theme.colors.success[500]} />
            <Text style={styles.summaryText}>PIN Code enabled</Text>
          </View>
        )}
        {enableBiometric && (
          <View style={styles.summaryItem}>
            <Ionicons name="checkmark-circle" size={20} color={theme.colors.success[500]} />
            <Text style={styles.summaryText}>{getBiometricLabel()} enabled</Text>
          </View>
        )}
      </View>

      <Button
        title={isInitialSetup ? "Go to Wallet" : "Done"}
        onPress={handleFinish}
        style={styles.finishButton}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={step === 'complete' ? 'Complete' : 'Security Setup'}
        showBack={step !== 'complete'}
      />

      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {step === 'options' && renderOptionsStep()}
        {step === 'pin' && renderPinStep()}
        {step === 'confirmPin' && renderConfirmPinStep()}
        {step === 'biometric' && renderBiometricStep()}
        {step === 'complete' && renderCompleteStep()}
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
  shieldIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[4],
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
  optionsContainer: {
    gap: theme.spacing[3],
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionCardActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[50],
  },
  optionIcon: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[4],
  },
  optionIconActive: {
    backgroundColor: theme.colors.primary[500],
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: 2,
  },
  optionDesc: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  optionCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
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
  completeContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[6],
  },
  completeIcon: {
    marginBottom: theme.spacing[6],
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
  completeTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
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


