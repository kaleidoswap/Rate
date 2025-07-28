import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

interface ListItemProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const ListItem: React.FC<ListItemProps> = ({ children, style }) => {
  return (
    <View style={[styles.container, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
}); 