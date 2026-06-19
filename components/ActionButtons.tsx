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
    onHistory: () => void;
}

type Tone = 'receive' | 'swap' | 'send' | 'activity';

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

function tileStyle(tone: Tone): { backgroundColor: string; glyph: string; border?: string } {
    switch (tone) {
        case 'receive':
            return { backgroundColor: theme.colors.primary[500], glyph: theme.colors.text.inverse };
        case 'send':
            // Tinted surface with a green glyph — visually distinct from Receive's solid fill.
            return { backgroundColor: theme.colors.primary[50]!, glyph: theme.colors.primary[500], border: theme.colors.primary[100]! };
        case 'swap':
            // Violet = secondary brand accent (protocol/secondary action). It's a
            // dark fill in both themes, so the glyph stays white regardless of theme.
            return { backgroundColor: theme.colors.brand.violet, glyph: '#FFFFFF' };
        case 'activity':
        default:
            return { backgroundColor: theme.colors.surface.tertiary, glyph: theme.colors.text.secondary, border: theme.colors.border.medium };
    }
}

export const ActionButtons: React.FC<ActionButtonsProps> = (props) => {
    return (
        <View style={styles.container}>
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

            <PressableScale
                style={styles.activityButton}
                onPress={() => {
                    feedback.tap();
                    props.onHistory?.();
                }}
                accessibilityRole="button"
                accessibilityLabel="Activity"
            >
                <Ionicons name="time-outline" size={16} color={theme.colors.text.secondary} />
                <Text style={styles.activityButtonText}>Activity</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.text.tertiary} />
            </PressableScale>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: theme.spacing[4],
        marginTop: -theme.spacing[5],
        marginBottom: theme.spacing[4],
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.xl,
        paddingVertical: 18,
        paddingHorizontal: theme.spacing[2],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
        ...theme.shadows.md,
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
    activityButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing[1.5],
        marginTop: theme.spacing[2.5],
        paddingVertical: theme.spacing[2.5],
        borderRadius: theme.borderRadius.md,
    },
    activityButtonText: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.secondary,
        letterSpacing: 0.2,
    },
});
