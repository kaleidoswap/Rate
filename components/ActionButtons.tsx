import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { haptic } from '../utils/haptics';

interface ActionButtonsProps {
    onSend: () => void;
    onReceive: () => void;
    onSwap: () => void;
    onHistory: () => void;
}

type Tone = 'green' | 'violet' | 'neutral';

const ACTION_ITEMS: Array<{
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: Tone;
    action: keyof ActionButtonsProps;
}> = [
    { key: 'send', label: 'Send', icon: 'arrow-up', tone: 'green', action: 'onSend' },
    { key: 'receive', label: 'Receive', icon: 'arrow-down', tone: 'green', action: 'onReceive' },
    { key: 'swap', label: 'Swap', icon: 'swap-horizontal', tone: 'violet', action: 'onSwap' },
    { key: 'history', label: 'Activity', icon: 'time', tone: 'neutral', action: 'onHistory' },
];

// Brand accents (green = primary, violet = protocol/secondary action).
const VIOLET = '#6F32FF';

function tileStyle(tone: Tone): { backgroundColor: string; glyph: string; border?: string } {
    switch (tone) {
        case 'green':
            return { backgroundColor: theme.colors.primary[500], glyph: theme.colors.text.inverse };
        case 'violet':
            return { backgroundColor: VIOLET, glyph: '#FFFFFF' };
        case 'neutral':
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
                        <TouchableOpacity
                            key={item.key}
                            style={styles.actionButton}
                            onPress={() => {
                                haptic.light();
                                props[item.action]?.();
                            }}
                            activeOpacity={0.8}
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
                        </TouchableOpacity>
                    );
                })}
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
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    actionButton: {
        alignItems: 'center',
        flex: 1,
    },
    actionButtonTile: {
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
