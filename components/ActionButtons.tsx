import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';
import { PressableScale } from './PressableScale';

interface ActionButtonsProps {
    onSend: () => void;
    onReceive: () => void;
    onSwap?: () => void;
}

const ACTION_ITEMS: Array<{
    action: keyof ActionButtonsProps;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
}> = [
    { action: 'onReceive', label: 'Receive', icon: 'arrow-down' },
    { action: 'onSend', label: 'Send', icon: 'arrow-up' },
    { action: 'onSwap', label: 'Swap', icon: 'swap-horizontal' },
];

export const ActionButtons: React.FC<ActionButtonsProps> = (props) => {
    const theme = useAppTheme();
    const styles = makeStyles(theme);
    const { fontScale } = useWindowDimensions();
    const stacked = fontScale >= 1.4;

    return (
        <View style={[styles.actions, stacked && styles.stacked]}>
            {ACTION_ITEMS.map(({ action, label, icon }) => {
                const runAction = props[action];
                if (!runAction) return null;
                const primary = action === 'onReceive';
                const color = primary ? theme.colors.text.inverse : theme.colors.text.primary;
                return (
                    <PressableScale
                        key={action}
                        style={[styles.action, stacked && styles.wideAction, primary && styles.primaryAction]}
                        onPress={() => {
                            feedback.tap();
                            runAction();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                    >
                        <Ionicons name={icon} size={22} color={color} />
                        <Text style={[styles.label, { color }]}>{label}</Text>
                    </PressableScale>
                );
            })}
        </View>
    );
};

const makeStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    actions: {
        flexDirection: 'row',
        gap: theme.spacing[2],
    },
    stacked: {
        flexDirection: 'column',
    },
    action: {
        flex: 1,
        minHeight: 64,
        minWidth: 0,
        justifyContent: 'center',
        alignItems: 'center',
        gap: theme.spacing[1],
        padding: theme.spacing[2],
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.surface.secondary,
    },
    wideAction: {
        flex: 0,
        flexDirection: 'row',
        gap: theme.spacing[2],
    },
    primaryAction: {
        backgroundColor: theme.colors.primary[500],
    },
    label: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.semibold,
        textAlign: 'center',
    },
});
