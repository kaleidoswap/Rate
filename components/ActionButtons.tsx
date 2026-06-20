import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';
import { PressableScale } from './PressableScale';

interface ActionButtonsProps {
    onSend: () => void;
    onReceive: () => void;
    onSwap: () => void;
}

const ACTION_ITEMS: Array<{
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    action: keyof ActionButtonsProps;
}> = [
    { key: 'receive', label: 'Receive', icon: 'arrow-down', action: 'onReceive' },
    { key: 'swap', label: 'Swap', icon: 'swap-horizontal', action: 'onSwap' },
    { key: 'send', label: 'Send', icon: 'arrow-up', action: 'onSend' },
];

export const ActionButtons: React.FC<ActionButtonsProps> = (props) => {
    return (
        <View style={styles.actionButtons}>
            {ACTION_ITEMS.map(item => (
                <PressableScale
                    key={item.key}
                    style={styles.pill}
                    onPress={() => {
                        feedback.tap();
                        props[item.action]?.();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                >
                    <Ionicons name={item.icon} size={18} color={theme.colors.primary[500]} />
                    <Text style={styles.pillLabel}>{item.label}</Text>
                </PressableScale>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    actionButtons: {
        flexDirection: 'row',
        gap: theme.spacing[2],
    },
    pill: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 40,
        borderRadius: 12,
        paddingHorizontal: 10,
        gap: 6,
        backgroundColor: theme.colors.primary[500] + '26',
    },
    pillLabel: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.5,
        color: theme.colors.primary[500],
    },
});
