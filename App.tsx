// App.tsx
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator, Platform, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeProvider } from '@react-navigation/native';
import { LoadingScreen } from './components/LoadingScreen';
import { BrandIntro } from './components/brand/BrandIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import NetworkService from './services/NetworkService';

import { store, persistor } from './store';
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
import SwapScreen from './screens/SwapScreen';
import NostrContactsScreen from './screens/NostrContactsScreen';
import AssetDetailScreen from './screens/AssetDetailScreen';
import PaymentConfirmationScreen from './screens/PaymentConfirmationScreen';
import SecuritySetupScreen from './screens/SecuritySetupScreen';
import HistoryScreen from './screens/HistoryScreen';
import LSPScreen from './screens/LSPScreen';
import PairDesktopScreen from './screens/PairDesktopScreen';

type RootStackParamList = {
  InitialLoad: undefined;
  WalletSetup: undefined;
  WalletRestore: undefined;
  WalletList: undefined;
  AddWallet: undefined;
  WalletSettings: { walletId: number };
  SecuritySetup: { walletId?: number; isInitialSetup?: boolean };
  Dashboard: undefined;
  Settings: undefined;
  Send: { selectedAsset?: any } | undefined;
  Receive: { selectedAsset?: any } | undefined;
  QRScanner: undefined;
  PaymentConfirmation: { paymentData: any };
  AIAssistant: undefined;
  Assets: undefined;
  Swap: undefined;
  NostrContacts: undefined;
  AssetDetail: { asset: any };
  History: undefined;
  LSP: undefined;
  OpenChannel: undefined;
  IssueAsset: undefined;
  Channels: undefined;
  PairDesktop: undefined;
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
            <Ionicons
              name={focused ? 'sparkles' : 'sparkles-outline'}
              size={24}
              color={color}
            />
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
        <Stack.Screen name="Receive" component={ReceiveScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="QRScanner" component={QRScannerScreen} />
        <Stack.Screen
          name="PairDesktop"
          component={PairDesktopScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen name="PaymentConfirmation" component={PaymentConfirmationScreen} />
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
          name="NostrContacts"
          component={NostrContactsScreen}
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

function AppLoadingScreen() {
  return <LoadingScreen variant="app" title="Loading KaleidoSwap Wallet" />;
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

    return () => {
      networkService.cleanup();
    };
  }, []);

  return (
    <ErrorBoundary>
      <Provider store={store}>
        <PersistGate loading={<AppLoadingScreen />} persistor={persistor}>
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

