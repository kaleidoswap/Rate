import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';
import { PressableScale } from './PressableScale';

interface ActionButtonsProps {
    onSend?: () => void;
    onReceive?: () => void;
    onSwap?: () => void;
}

const ACTION_ITEMS: Array<{
    action: keyof ActionButtonsProps;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    variant: 'receive' | 'swap' | 'send';
}> = [
    { action: 'onReceive', label: 'Receive', icon: 'arrow-down', variant: 'receive' },
    { action: 'onSwap', label: 'Swap', icon: 'swap-horizontal', variant: 'swap' },
    { action: 'onSend', label: 'Send', icon: 'send-outline', variant: 'send' },
];

export const ActionButtons: React.FC<ActionButtonsProps> = (props) => {
    const theme = useAppTheme();
    const styles = makeStyles(theme);
    const { width, fontScale } = useWindowDimensions();
    const stacked = fontScale >= 1.4;
    const inline = stacked || (width >= 350 && fontScale <= 1.2);

    return (
        <View style={[styles.actions, stacked && styles.stacked]}>
            {ACTION_ITEMS.map(({ action, label, icon, variant }) => {
                const callback = props[action];
                const primary = variant === 'receive' && !!callback;
                const color = !callback ? theme.colors.text.tertiary : primary ? theme.colors.text.inverse : theme.colors.text.primary;
                const iconColor = callback && variant === 'swap' ? theme.colors.tx.swap : color;
                return (
                    <PressableScale
                        key={action}
                        style={[
                            styles.action,
                            styles[variant],
                            inline && styles.inline,
                            inline && variant === 'send' && styles.trailingIcon,
                            stacked && styles.wideAction,
                            !callback && styles.disabled,
                        ]}
                        onPress={callback ? () => {
                            feedback.tap();
                            callback();
                        } : undefined}
                        disabled={!callback}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{ disabled: !callback }}
                    >
                        <Ionicons name={icon} size={16} color={iconColor} />
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
        minHeight: theme.spacing[12],
        minWidth: 0,
        justifyContent: 'center',
        alignItems: 'center',
        gap: theme.spacing[1],
        paddingVertical: theme.spacing[1.5],
        paddingHorizontal: theme.spacing[1.5],
    },
    inline: {
        flexDirection: 'row',
    },
    trailingIcon: {
        flexDirection: 'row-reverse',
    },
    wideAction: {
        flex: 0,
        gap: theme.spacing[2],
    },
    receive: {
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.primary[500],
    },
    swap: {
        borderRadius: theme.borderRadius.base,
        backgroundColor: theme.colors.info[50],
    },
    send: {
        borderRadius: theme.borderRadius.full,
        borderWidth: 1,
        borderColor: theme.colors.border.dark,
    },
    disabled: {
        backgroundColor: theme.colors.surface.secondary,
        borderColor: theme.colors.border.light,
    },
    label: {
        flexShrink: 1,
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.semibold,
        textAlign: 'center',
    },
});
