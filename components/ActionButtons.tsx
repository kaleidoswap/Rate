import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

interface ActionButtonsProps {
    onSend: () => void;
    onReceive: () => void;
    onSwap: () => void;
    onHistory: () => void;
}

const ACTION_ITEMS: Array<{
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    colors: [string, string];
    action: keyof ActionButtonsProps;
}> = [
    { key: 'send', label: 'Send', icon: 'arrow-up', colors: ['#F94040', '#E03535'], action: 'onSend' },
    { key: 'receive', label: 'Receive', icon: 'arrow-down', colors: ['#2BEE79', '#1FA855'], action: 'onReceive' },
    { key: 'swap', label: 'Swap', icon: 'swap-horizontal', colors: ['#F59E0B', '#D97706'], action: 'onSwap' },
    { key: 'history', label: 'Activity', icon: 'time', colors: ['#4290FF', '#2563EB'], action: 'onHistory' },
];

export const ActionButtons: React.FC<ActionButtonsProps> = (props) => {
    return (
        <View style={styles.container}>
            <View style={styles.actionButtons}>
                {ACTION_ITEMS.map(item => (
                    <TouchableOpacity
                        key={item.key}
                        style={styles.actionButton}
                        onPress={props[item.action]}
                        activeOpacity={0.7}
                    >
                        <LinearGradient
                            colors={item.colors}
                            style={styles.actionButtonGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Ionicons name={item.icon} size={22} color="white" />
                        </LinearGradient>
                        <Text style={styles.actionButtonText}>{item.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        marginTop: -20,
        marginBottom: 16,
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: 20,
        paddingVertical: 16,
        paddingHorizontal: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 4,
    },
    actionButton: {
        alignItems: 'center',
        flex: 1,
    },
    actionButtonGradient: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 6,
    },
    actionButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
});
