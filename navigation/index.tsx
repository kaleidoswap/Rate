import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LSPScreen from '../screens/LSPScreen';
import WalletListScreen from '../screens/WalletListScreen';
import AddWalletScreen from '../screens/AddWalletScreen';
import WalletSettingsScreen from '../screens/WalletSettingsScreen';

export type RootStackParamList = {
  LSP: undefined;
  WalletList: undefined;
  AddWallet: undefined;
  WalletSettings: { walletId: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const RateNavigation = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="WalletList"
        component={WalletListScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="AddWallet"
        component={AddWalletScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="WalletSettings"
        component={WalletSettingsScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="LSP"
        component={LSPScreen}
        options={{
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
};

export default RateNavigation; 