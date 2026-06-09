// App.tsx
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { View, ActivityIndicator, Platform, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeProvider } from '@react-navigation/native';
import { BrandLoading } from './components/brand/BrandLoading';
import { BrandIntro } from './components/brand/BrandIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import ChatNotifications from './components/ChatNotifications';
import NetworkService from './services/NetworkService';
import { preloadFeedback } from './utils/feedback';

import { store, persistor } from './store';
import { selectAiMode } from './store/slices/settingsSlice';
import QVACService from './services/QVACService';
import { theme, createNavigationTheme } from './theme';
import { AppThemeProvider, useAppTheme } from './theme/ThemeProvider';
import { KaleidoThemeProvider } from '@kaleidorg/kaleido-ui/native';
import InitialLoadScreen from './screens/InitialLoadScreen';
import WalletSetupScreen from './screens/WalletSetupScreen';
import WalletRestoreScreen from './screens/WalletRestoreScreen';
import WalletListScreen from './screens/WalletListScreen';
import AddWalletScreen from './screens/AddWalletScreen';
import WalletSettingsScreen from './screens/WalletSettingsScreen';
import DashboardScreen from './screens/DashboardScreen';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
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
  Send: { selectedAsset?: any } | undefined;
  Receive: { selectedAsset?: any } | undefined;
  QRScanner: { mode?: 'payment' | 'contact'; returnScreen?: string } | undefined;
  PaymentConfirmation: { paymentData: any };
  PaymentSuccess: PaymentSuccessParams;
  AIAssistant: undefined;
  Assets: undefined;
  Swap: undefined;
  NostrSettings: undefined;
  AssetDetail: { asset: any };
  History: undefined;
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
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={24}
              color={color}
            />
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
        name="Scan"
        component={QRScannerScreen}
        options={({ navigation }) => ({
          tabBarLabel: '',
          tabBarIcon: ({ focused }) => (
            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => navigation.navigate('QRScanner')}
            >
              <LinearGradient
                colors={theme.colors.primary.gradient as [string, string]}
                style={styles.scanButtonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Ionicons name="qr-code" size={28} color="white" />
              </LinearGradient>
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarLabel: 'Map',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'map' : 'map-outline'}
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
          contentStyle: { backgroundColor: theme.colors.background.secondary },
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
          component={SettingsScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen name="Send" component={SendScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="NostrSettings" component={NostrSettingsScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Receive" component={ReceiveScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="QRScanner"
          component={QRScannerScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="PairDesktop"
          component={PairDesktopScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="MindSettings"
          component={MindSettingsScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="NWCConnect"
          component={NWCConnectScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="PaymentConfirmation" component={PaymentConfirmationScreen} />
        <Stack.Screen
          name="PaymentSuccess"
          component={PaymentSuccessScreen}
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="AIAssistant" component={AIAssistantScreen} />
        <Stack.Screen name="Assets" component={AssetsScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="Swap"
          component={SwapScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="AssetDetail"
          component={AssetDetailScreen}
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
        <Stack.Screen name="LSP" component={LSPScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="OpenChannel" component={LSPScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Channels" component={LSPScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="IssueAsset" component={AssetsScreen} options={{ presentation: 'modal', headerShown: false }} />
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

  return (
    <ErrorBoundary>
      <Provider store={store}>
        <PersistGate loading={<AppLoadingScreen />} persistor={persistor}>
          <QVACEnabledSync />
          <ChatNotifications />
          <AppThemeProvider>
            <KaleidoThemeProvider>
              <ThemeProvider value={navigationTheme}>
                <StatusBar style="light" backgroundColor="transparent" translucent={true} />
                <AppNavigator />
                <ToastContainer />
              </ThemeProvider>
            </KaleidoThemeProvider>
          </AppThemeProvider>
        </PersistGate>
      </Provider>
      {!introDone && <BrandIntro onFinish={() => setIntroDone(true)} />}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  scanButton: {
    top: 10,
    justifyContent: 'center',
    alignItems: 'center',
    height: 56,
  },
  scanButtonGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});

