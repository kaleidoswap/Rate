// screens/NostrSettingsScreen.tsx
//
// Dedicated home for everything Nostr: identity, profile, relays, keys and the
// link to connect an external Lightning wallet (NWC), all rendered by
// NostrProfileManager. Broken out of the main Settings screen so social
// settings have their own space.
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { theme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import NostrProfileManager from '../components/NostrProfileManager';

interface Props {
  navigation: any;
}

export default function NostrSettingsScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <ScreenHeader title="Nostr" showBack />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <NostrProfileManager navigation={navigation} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  scroll: { flex: 1 },
  content: { padding: theme.spacing[4], paddingBottom: theme.spacing[10] },
});
