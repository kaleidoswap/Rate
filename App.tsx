// App.tsx
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { View, Text, ActivityIndicator, Platform, SafeAreaView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletTabBar } from './components/WalletTabBar';
import { ThemeProvider } from '@react-navigation/native';
import { BrandLoading } from './components/brand/BrandLoading';
import { BrandIntro } from './components/brand/BrandIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import { PersistenceLoading } from './components/PersistenceLoading';
import { AppLockGate } from './components/AppLockGate';
import { KaleidoPayRecovery } from './components/KaleidoPayRecovery';
import { NwcPaymentApprover } from './components/NwcPaymentApprover';
import ChatNotifications from './components/ChatNotifications';
import NetworkService from './services/NetworkService';
import { preloadFeedback } from './utils/feedback';

import { store, persistor } from './store';
import { selectAiMode } from './store/slices/settingsSlice';
import QVACService from './services/QVACService';
import { theme, createNavigationTheme } from './theme';
import { AppThemeProvider, useAppTheme } from './theme/ThemeProvider';
import { KaleidoThemeProvider } from '@kaleidorg/kaleido-ui/native';
import { useFonts } from 'expo-font';
import { kaleidoFonts } from '@kaleidorg/kaleido-ui/native/fonts';
// Side effect: apply Satoshi to every <Text>/<TextInput> app-wide.
import './theme/satoshiText';
import InitialLoadScreen from './screens/InitialLoadScreen';
import WalletSetupScreen from './screens/WalletSetupScreen';
import WalletRestoreScreen from './screens/WalletRestoreScreen';
import WalletListScreen from './screens/WalletListScreen';
import AddWalletScreen from './screens/AddWalletScreen';
import WalletSettingsScreen from './screens/WalletSettingsScreen';
import DashboardScreen from './screens/DashboardScreen';
import { asModalScreen } from './components/ModalPresentation';
import SendScreen from './screens/SendScreen';
import KaleidoPayScreen from './screens/KaleidoPayScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import MerchantOfferScreen from './screens/MerchantOfferScreen';
import BarkScreen from './screens/BarkScreen';
import DesignSystemScreen from './screens/DesignSystemScreen';
import QRScannerScreen from './screens/QRScannerScreen';
import AssetsScreen from './screens/AssetsScreen';
import SettingsScreen from './screens/SettingsScreen';
import AIAssistantScreen from './screens/AIAssistantScreen';
import MapScreen from './screens/MapScreen';
import ContactsScreen from './screens/ContactsScreen';
import ChatScreen from './screens/ChatScreen';
import SwapScreen from './screens/SwapScreen';
import NostrSettingsScreen from './screens/NostrSettingsScreen';
import AssetDetailScreen from './screens/AssetDetailScreen';
import PaymentConfirmationScreen from './screens/PaymentConfirmationScreen';
import PaymentSuccessScreen, { PaymentSuccessParams } from './screens/PaymentSuccessScreen';
import SecuritySetupScreen from './screens/SecuritySetupScreen';
import NostrSetupScreen from './screens/NostrSetupScreen';
import HistoryScreen from './screens/HistoryScreen';
import LSPScreen from './screens/LSPScreen';
import PairDesktopScreen from './screens/PairDesktopScreen';
import MindSettingsScreen from './screens/MindSettingsScreen';
import NWCConnectScreen from './screens/NWCConnectScreen';

type RootStackParamList = {
  InitialLoad: undefined;
  WalletSetup: undefined;
  WalletRestore: undefined;
  WalletList: undefined;
  AddWallet: undefined;
  WalletSettings: { walletId: number };
  SecuritySetup: { walletId?: number; isInitialSetup?: boolean };
  NostrSetup: { isInitialSetup?: boolean } | undefined;
  Dashboard: undefined;
  Settings: undefined;
  Send: { selectedAsset?: any; preferredAccount?: 'BARK' } | undefined;
  MerchantOffer: undefined;
  KaleidoPay: { code?: string } | undefined;
  Receive: { selectedAsset?: any } | undefined;
  QRScanner: { mode?: 'payment' | 'contact'; returnScreen?: string } | undefined;
  PaymentConfirmation: { paymentData: any };
  PaymentSuccess: PaymentSuccessParams;
  Bark: undefined;
  DesignSystem: undefined;
  AIAssistant: undefined;
  Assets: undefined;
  Swap: undefined;
  NostrSettings: undefined;
  AssetDetail: { asset: any };
  History: undefined;
  Map: undefined;
  LSP: undefined;
  OpenChannel: undefined;
  IssueAsset: undefined;
  Channels: undefined;
  PairDesktop: undefined;
  MindSettings: undefined;
  NWCConnect: { scanned?: string } | undefined;
  Chat: { pubkey: string; name?: string; npub?: string; avatarUrl?: string };
};

type TabBarIconProps = {
  focused: boolean;
  color: string;
  size: number;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function DashboardTabs() {
  const theme = useAppTheme();

  return (
    <Tab.Navigator
      tabBar={(props) => <WalletTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary[600],
        tabBarInactiveTintColor: theme.colors.gray[400],
        tabBarStyle: {
          backgroundColor: theme.colors.surface.primary,
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: Platform.OS === 'ios' ? 8 : 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 12,
          shadowColor: theme.shadows.lg.shadowColor,
          shadowOffset: theme.shadows.lg.shadowOffset,
          shadowOpacity: theme.shadows.lg.shadowOpacity,
          shadowRadius: theme.shadows.lg.shadowRadius,
        },
        tabBarLabelStyle: {
          fontSize: theme.typography.fontSize.xs,
          fontWeight: '600',
          marginTop: 4,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Wallet',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'wallet' : 'wallet-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Activity"
        component={HistoryScreen}
        options={{
          tabBarLabel: 'Activity',
          tabBarIcon: ({ focused, color }: TabBarIconProps) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          tabBarLabel: 'Contacts',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Mind"
        component={AIAssistantScreen}
        options={{
          tabBarLabel: 'Mind',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <MaterialCommunityIcons name="brain" size={24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const navigationTheme = createNavigationTheme();
  const theme = useAppTheme();

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="InitialLoad"
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
          contentStyle: { backgroundColor: theme.colors.background.primary },
        }}
      >
        <Stack.Screen name="InitialLoad" component={InitialLoadScreen} />
        <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
        <Stack.Screen name="WalletRestore" component={WalletRestoreScreen} />
        <Stack.Screen name="WalletList" component={WalletListScreen} />
        <Stack.Screen name="AddWallet" component={AddWalletScreen} />
        <Stack.Screen name="WalletSettings" component={WalletSettingsScreen} />
        <Stack.Screen name="SecuritySetup" component={SecuritySetupScreen} />
        <Stack.Screen name="NostrSetup" component={NostrSetupScreen} />
        <Stack.Screen name="Dashboard" component={DashboardTabs} />
        <Stack.Screen
          name="Settings"
          component={asModalScreen(SettingsScreen)}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen name="KaleidoPay" component={asModalScreen(KaleidoPayScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Send" component={asModalScreen(SendScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="NostrSettings" component={asModalScreen(NostrSettingsScreen)} options={{ presentation: 'modal', headerShown: false }} />
        {__DEV__ && <Stack.Screen name="DesignSystem" component={asModalScreen(DesignSystemScreen)} options={{ presentation: 'modal', headerShown: false }} />}
        <Stack.Screen name="Bark" component={asModalScreen(BarkScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="MerchantOffer" component={asModalScreen(MerchantOfferScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Receive" component={asModalScreen(ReceiveScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="QRScanner"
          component={asModalScreen(QRScannerScreen)}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="PairDesktop"
          component={asModalScreen(PairDesktopScreen)}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="MindSettings"
          component={asModalScreen(MindSettingsScreen)}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="NWCConnect"
          component={asModalScreen(NWCConnectScreen)}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="PaymentConfirmation" component={PaymentConfirmationScreen} />
        <Stack.Screen
          name="PaymentSuccess"
          component={PaymentSuccessScreen}
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="Map" component={MapScreen} />
        <Stack.Screen name="AIAssistant" component={AIAssistantScreen} />
        <Stack.Screen name="Assets" component={asModalScreen(AssetsScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="Swap"
          component={asModalScreen(SwapScreen)}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="AssetDetail"
          component={asModalScreen(AssetDetailScreen)}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{
            presentation: 'card',
            headerShown: false,
          }}
        />
        <Stack.Screen name="LSP" component={asModalScreen(LSPScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="OpenChannel" component={asModalScreen(LSPScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Channels" component={asModalScreen(LSPScreen)} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="IssueAsset" component={asModalScreen(AssetsScreen)} options={{ presentation: 'modal', headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * Mirrors the persisted KaleidoMind mode (settings.aiMode) into the QVACService master
 * kill switch, so the on-device AI worklet can never start unless the user has
 * explicitly opted in. Rendered inside the Redux Provider + PersistGate.
 */
function QVACEnabledSync() {
  const aiMode = useSelector(selectAiMode);
  React.useEffect(() => {
    const svc = QVACService.getInstance();
    svc.setEnabled(aiMode !== 'off');
    // Desktop mode => delegate to the paired provider; Local/Off => on-device.
    void svc.setDelegateEnabled(aiMode === 'delegate');
  }, [aiMode]);
  return null;
}

function AppLoadingScreen() {
  // Same branded loader the BrandIntro fades into — keeps startup seamless.
  return <BrandLoading />;
}

export default function App() {
  const navigationTheme = createNavigationTheme();
  const [introDone, setIntroDone] = React.useState(false);
  // Load the Satoshi brand typeface (shipped by kaleido-ui) before first paint
  // so the app-wide Text patch resolves real faces rather than the system fallback.
  const [fontsLoaded] = useFonts(kaleidoFonts);

  React.useEffect(() => {
    // Initialize network monitoring
    const networkService = NetworkService.getInstance();
    networkService.initialize().catch(error => {
      console.error('Failed to initialize network monitoring:', error);
    });

    // Warm the UI sound cache so the first tap/chime plays without synthesis lag.
    preloadFeedback();

    return () => {
      networkService.cleanup();
    };
  }, []);

  // Hold on the branded loader until Satoshi is registered (all hooks above run first).
  if (!fontsLoaded) {
    return <AppLoadingScreen />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <Provider store={store}>
            <PersistGate loading={<PersistenceLoading />} persistor={persistor}>
              <QVACEnabledSync />
              <KaleidoPayRecovery />
              <ChatNotifications />
              <AppThemeProvider>
                <KaleidoThemeProvider>
                  <ThemeProvider value={navigationTheme}>
                    <StatusBar style="light" backgroundColor="transparent" translucent={true} />
                    <AppNavigator />
                    <ToastContainer />
                    <NwcPaymentApprover />
                    <AppLockGate />
                  </ThemeProvider>
                </KaleidoThemeProvider>
              </AppThemeProvider>
            </PersistGate>
          </Provider>
          {!introDone && <BrandIntro onFinish={() => setIntroDone(true)} />}
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

