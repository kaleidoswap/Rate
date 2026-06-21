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

type Tone = 'receive' | 'swap' | 'send';

const ACTION_ITEMS: Array<{
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: Tone;
    action: keyof ActionButtonsProps;
}> = [
    { key: 'receive', label: 'Receive', icon: 'arrow-down', tone: 'receive', action: 'onReceive' },
    { key: 'swap', label: 'Swap', icon: 'swap-horizontal', tone: 'swap', action: 'onSwap' },
    { key: 'send', label: 'Send', icon: 'arrow-up', tone: 'send', action: 'onSend' },
];

// Restores the previous colored circular tiles: Receive = solid brand green
// (white glyph), Send = tinted-green surface (green glyph) to read as distinct
// from Receive's solid fill, Swap = violet secondary accent (white glyph).
function tileStyle(tone: Tone): { backgroundColor: string; glyph: string; border?: string } {
    switch (tone) {
        case 'receive':
            return { backgroundColor: theme.colors.primary[500], glyph: theme.colors.text.inverse };
        case 'send':
            return { backgroundColor: theme.colors.primary[50]!, glyph: theme.colors.primary[500], border: theme.colors.primary[100]! };
        case 'swap':
        default:
            return { backgroundColor: theme.colors.brand.violet, glyph: '#FFFFFF' };
    }
}

export const ActionButtons: React.FC<ActionButtonsProps> = (props) => {
    return (
        <View style={styles.actionButtons}>
            {ACTION_ITEMS.map(item => {
                const t = tileStyle(item.tone);
                return (
                    <PressableScale
                        key={item.key}
                        style={styles.actionButton}
                        onPress={() => {
                            feedback.tap();
                            props[item.action]?.();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                    >
                        <View
                            style={[
                                styles.actionButtonTile,
                                { backgroundColor: t.backgroundColor },
                                t.border ? { borderWidth: 1, borderColor: t.border } : null,
                            ]}
                        >
                            <Ionicons name={item.icon} size={22} color={t.glyph} />
                        </View>
                        <Text style={styles.actionButtonText}>{item.label}</Text>
                    </PressableScale>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    // Footer inside the BalanceCard — no own card chrome (the card provides it).
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    actionButton: {
        alignItems: 'center',
        flex: 1,
        gap: theme.spacing[2],
    },
    actionButtonTile: {
        width: 52,
        height: 52,
        borderRadius: 26,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionButtonText: {
        fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.primary,
        letterSpacing: 0.2,
    },
});
