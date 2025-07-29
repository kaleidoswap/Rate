import { createStackNavigator } from '@react-navigation/stack';
import LSPScreen from '../screens/LSPScreen';

export type RootStackParamList = {
  LSP: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const RateNavigation = () => {
  return (
    <Stack.Navigator>
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