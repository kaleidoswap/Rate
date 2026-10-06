// screens/WalletRestoreScreen.tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Animated,
  StatusBar,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
  TextInput,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { selectDisclosureLevel } from '../store/slices/settingsSlice';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { createNewWallet, setInitialized, setUnlocked } from '../store/slices/walletSlice';
import { theme } from '../theme';
import { NetworkConfig } from '../services/DatabaseService';
import { Button, Card, Input, ScreenHeader } from '../components';
import { AlertBanner } from '@kaleidorg/kaleido-ui/native';
import { ADVANCED_ACCOUNTS, LITE_ACCOUNTS, saveAccountPreferences, walletNetworksFor } from '../services/protocols/accountChoices';
import { useScreenCaptureProtection } from '../hooks/useScreenCaptureProtection';

interface Props {
  navigation: any;
}

type RestoreStep = 'input' | 'restoring' | 'success';
const WORD_COUNTS = [12, 24] as const;

export default function WalletRestoreScreen({ navigation }: Props) {
  // The recovery phrase is typed on this screen: keep it out of screenshots.
  useScreenCaptureProtection(true);
  const dispatch = useDispatch();
  const disclosure = useSelector(selectDisclosureLevel);
  const [step, setStep] = useState<RestoreStep>('input');
  const [name, setName] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [mnemonicWords, setMnemonicWords] = useState<string[]>(Array(12).fill(''));
  const [inputMode, setInputMode] = useState<'text' | 'grid'>('text');
  const [restoredWalletId, setRestoredWalletId] = useState<number | null>(null);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  const animateTransition = useCallback((nextStep: RestoreStep) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -30,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start(() => {
      setStep(nextStep);
      slideAnim.setValue(30);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        })
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  const animateSuccess = useCallback(() => {
    scaleAnim.setValue(0);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const validateMnemonic = (phrase: string): boolean => {
    const bip39 = require('bip39');
    return bip39.validateMnemonic(phrase);
  };

  const handleNext = () => {
    Keyboard.dismiss();

    if (step === 'input') {
      if (!name.trim()) {
        Alert.alert('Wallet Name Required', 'Please give your wallet a name to continue.');
        return;
      }

      // Get mnemonic from either text input or grid
      const finalMnemonic = inputMode === 'text' 
        ? mnemonic.trim().toLowerCase()
        : mnemonicWords.filter(w => w.trim()).join(' ').toLowerCase();

      if (!finalMnemonic) {
        Alert.alert('Recovery Phrase Required', 'Please enter your 12- or 24-word recovery phrase.');
        return;
      }

      // Validate mnemonic
      if (!validateMnemonic(finalMnemonic)) {
        Alert.alert(
          'Invalid Recovery Phrase', 
          'The recovery phrase you entered is invalid. Please check and try again.'
        );
        return;
      }

      setMnemonic(finalMnemonic);
      void handleRestore(finalMnemonic);
    }
  };

  const handleRestore = async (phrase: string) => {
    animateTransition('restoring');

    try {
      // The accounts a new wallet gets in the current mode (Lite: Spark and RGB on
      // this phone). Others, and a Lightning wallet over NWC, are turned on in Settings.
      const choice = disclosure === 'advanced' ? ADVANCED_ACCOUNTS : LITE_ACCOUNTS;
      const selectedNetworks: Omit<NetworkConfig, 'id' | 'wallet_id'>[] = walletNetworksFor(choice);
      await saveAccountPreferences(phrase, choice);

      // @ts-ignore
      const resultAction = await dispatch(createNewWallet({
        name,
        mnemonic: phrase,
        networks: selectedNetworks
      }));

      if (createNewWallet.fulfilled.match(resultAction)) {
        const wallet = resultAction.payload;
        if (wallet) {
          setRestoredWalletId(wallet.id || null);
          dispatch(setInitialized(true));
          dispatch(setUnlocked(true));

          // Show success screen
          setStep('success');
          animateSuccess();
        }
      } else {
        throw new Error('Failed to restore wallet');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to restore wallet');
      animateTransition('input');
    }
  };

  // Same ending as a new wallet: offer a PIN / biometrics before opening the wallet.
  const handleSetupSecurity = () => {
    navigation.replace('SecuritySetup', { walletId: restoredWalletId ?? undefined, isInitialSetup: true });
  };
  const handleFinish = () => {
    navigation.replace('Dashboard');
  };

  const chooseWordCount = (count: 12 | 24) => {
    setWordCount(count);
    setMnemonicWords((words) => Array.from({ length: count }, (_, i) => words[i] ?? ''));
  };

  const handleWordChange = (index: number, value: string) => {
    const newWords = [...mnemonicWords];
    newWords[index] = value.trim().toLowerCase();
    setMnemonicWords(newWords);
  };

  const renderInputStep = () => (
    <ScrollView
      style={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.iconHeader}>
        <View style={styles.iconContainer}>
          <Ionicons name="key" size={32} color={theme.colors.primary[500]} />
        </View>
      </View>

      <Text style={styles.stepTitle}>Restore Wallet</Text>
      <Text style={styles.stepDescription}>
        Enter your wallet name and your 12- or 24-word recovery phrase.
      </Text>

      <View style={styles.inputWrapper}>
        <Input
          label="Wallet Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. My Restored Wallet"
          returnKeyType="done"
          autoCapitalize="words"
          autoCorrect={false}
          variant="outlined"
          size="lg"
        />
      </View>

      <View style={styles.modeSelector}>
        <TouchableOpacity
          style={[styles.modeButton, inputMode === 'text' && styles.modeButtonActive]}
          onPress={() => setInputMode('text')}
        >
          <Ionicons 
            name="document-text-outline" 
            size={18} 
            color={inputMode === 'text' ? theme.colors.primary[600] : theme.colors.text.secondary} 
          />
          <Text style={[styles.modeButtonText, inputMode === 'text' && styles.modeButtonTextActive]}>
            Text Input
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, inputMode === 'grid' && styles.modeButtonActive]}
          onPress={() => setInputMode('grid')}
        >
          <Ionicons 
            name="grid-outline" 
            size={18} 
            color={inputMode === 'grid' ? theme.colors.primary[600] : theme.colors.text.secondary} 
          />
          <Text style={[styles.modeButtonText, inputMode === 'grid' && styles.modeButtonTextActive]}>
            Word Grid
          </Text>
        </TouchableOpacity>
      </View>

      {inputMode === 'text' ? (
        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>Recovery Phrase</Text>
          <TextInput
            style={styles.mnemonicTextInput}
            value={mnemonic}
            onChangeText={setMnemonic}
            placeholder="Enter your recovery phrase, words separated by spaces"
            placeholderTextColor={theme.colors.text.tertiary}
            multiline
            numberOfLines={4}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
          />
          <Text style={styles.inputHint}>
            Separate each word with a space
          </Text>
        </View>
      ) : (
        <View style={styles.inputWrapper}>
          <View style={styles.wordCountRow}>
            <Text style={[styles.inputLabel, { flex: 1 }]}>Recovery Phrase</Text>
            {WORD_COUNTS.map((count) => (
              <TouchableOpacity
                key={count}
                accessibilityRole="radio"
                accessibilityState={{ checked: wordCount === count }}
                accessibilityLabel={`${count} words`}
                onPress={() => chooseWordCount(count)}
                style={[styles.wordCountButton, wordCount === count && styles.modeButtonActive]}
              >
                <Text style={[styles.modeButtonText, wordCount === count && styles.modeButtonTextActive]}>{count} words</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Card style={styles.wordGridCard}>
            <View style={styles.wordGrid}>
              {mnemonicWords.map((word, index) => (
                <View key={index} style={styles.wordInputContainer}>
                  <Text style={styles.wordNumber}>{index + 1}</Text>
                  <TextInput
                    style={styles.wordInput}
                    value={word}
                    onChangeText={(value) => handleWordChange(index, value)}
                    placeholder={`word ${index + 1}`}
                    placeholderTextColor={theme.colors.text.tertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                  />
                </View>
              ))}
            </View>
          </Card>
        </View>
      )}

      <AlertBanner variant="info" style={styles.warningBox}>
        <Ionicons name="shield-checkmark" size={20} color={theme.colors.info[600]} />
        <Text style={styles.warningText}>
          Your recovery phrase is never sent to our servers. It's used only on your device to restore your wallet.
        </Text>
      </AlertBanner>
    </ScrollView>
  );

  const renderRestoringStep = () => (
    <View style={styles.centerContent}>
      <View style={styles.loadingContainer}>
        <Animated.View style={[styles.loadingRing, styles.loadingRing1]} />
        <Animated.View style={[styles.loadingRing, styles.loadingRing2]} />
        <View style={styles.loadingIcon}>
          <Ionicons name="key" size={36} color={theme.colors.primary[500]} />
        </View>
      </View>
      <Text style={styles.creatingTitle}>Restoring Your Wallet</Text>
      <Text style={styles.creatingDesc}>Please wait while we restore your wallet...</Text>
    </View>
  );

  const renderSuccessStep = () => (
    <View style={styles.centerContent}>
      <Animated.View style={[
        styles.successIconContainer,
        { transform: [{ scale: scaleAnim }] }
      ]}>
        <LinearGradient
          colors={theme.colors.success.gradient || [theme.colors.success[500], theme.colors.success[500]]}
          style={styles.successGradient}
        >
          <Ionicons name="checkmark" size={48} color="white" />
        </LinearGradient>
      </Animated.View>

      <Text style={styles.successTitle}>Wallet Restored!</Text>
      <Text style={styles.successDesc}>
        Your wallet "{name}" has been successfully restored.
      </Text>

      <Text style={styles.successDesc}>
        Protect it with a PIN code or Face ID / fingerprint.
      </Text>
      <Button
        title="Set Up Security"
        onPress={handleSetupSecurity}
        style={styles.finishButton}
      />
      <TouchableOpacity accessibilityRole="button" onPress={handleFinish} style={styles.skipButton}>
        <Text style={styles.skipButtonText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );


  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={step === 'success' ? 'Success' : 'Restore Wallet'}
        showBack={step === 'input'}
        onBack={() => { Keyboard.dismiss(); navigation.goBack(); }}
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 20}
      >
        <Animated.View
          style={[
            styles.contentContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <View style={styles.animatedContent}>
            {step === 'input' && renderInputStep()}
            {step === 'restoring' && renderRestoringStep()}
            {step === 'success' && renderSuccessStep()}
          </View>
        </Animated.View>

        {step === 'input' && (
          <View style={styles.footer}>
            <Button
              title="Restore Wallet"
              onPress={handleNext}
              style={styles.nextButton}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  headerGradient: {
    paddingBottom: theme.spacing[6],
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
  keyboardAvoid: {
    flex: 1,
    marginTop: -theme.spacing[4],
  },
  contentContainer: {
    flex: 1,
  },
  animatedContent: {
    flex: 1,
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  stepContent: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing[6],
    paddingBottom: 180,
  },
  iconHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[2],
  },
  stepDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[6],
    lineHeight: 24,
    paddingHorizontal: theme.spacing[2],
  },
  inputWrapper: {
    marginBottom: theme.spacing[4],
  },
  inputLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  modeSelector: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
  },
  modeButtonActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[50],
  },
  modeButtonText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  modeButtonTextActive: {
    color: theme.colors.primary[600],
    fontWeight: '600',
  },
  mnemonicTextInput: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
    padding: theme.spacing[4],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  inputHint: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    marginTop: theme.spacing[2],
  },
  wordGridCard: {
    padding: theme.spacing[4],
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[3],
  },
  wordInputContainer: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  wordNumber: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
    width: 20,
  },
  wordInput: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.info[50],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing[3],
  },
  warningText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    lineHeight: 20,
  },
  wordCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  wordCountButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border.medium,
  },
  skipButton: {
    marginTop: theme.spacing[4],
    padding: theme.spacing[3],
  },
  skipButtonText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[6],
  },
  loadingContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[6],
  },
  loadingRing: {
    position: 'absolute',
    borderRadius: 50,
    borderWidth: 3,
    borderColor: theme.colors.border.medium,
  },
  loadingRing1: {
    width: 100,
    height: 100,
    borderTopColor: theme.colors.primary[500],
  },
  loadingRing2: {
    width: 80,
    height: 80,
    borderBottomColor: theme.colors.primary[400],
  },
  loadingIcon: {
    width: 60,
    height: 60,
    backgroundColor: theme.colors.primary[50],
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatingTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  creatingDesc: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  successIconContainer: {
    marginBottom: theme.spacing[6],
  },
  successGradient: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.success[500],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  successTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  successDesc: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[8],
    textAlign: 'center',
  },
  finishButton: {
    width: '100%',
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  footer: {
    padding: theme.spacing[5],
    paddingBottom: Platform.OS === 'ios' ? theme.spacing[8] : theme.spacing[5],
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  nextButton: {
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});

