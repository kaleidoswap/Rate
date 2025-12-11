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

export const ActionButtons: React.FC<ActionButtonsProps> = ({
    onSend,
    onReceive,
    onSwap,
    onHistory,
}) => {
    return (
        <View style={styles.container}>
            <View style={styles.actionButtons}>
                {/* Receive Button */}
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={onReceive}
                    activeOpacity={0.7}
                >
                    <LinearGradient
                        colors={theme.colors.success.gradient as [string, string]}
                        style={styles.actionButtonGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Ionicons name="arrow-down" size={24} color="white" />
                    </LinearGradient>
                    <Text style={styles.actionButtonText}>Receive</Text>
                </TouchableOpacity>

                {/* Swap Button */}
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={onSwap}
                    activeOpacity={0.7}
                >
                    <LinearGradient
                        colors={theme.colors.warning.gradient as [string, string]}
                        style={styles.actionButtonGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Ionicons name="swap-horizontal" size={24} color="white" />
                    </LinearGradient>
                    <Text style={styles.actionButtonText}>Swap</Text>
                </TouchableOpacity>

                {/* Send Button */}
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={onSend}
                    activeOpacity={0.7}
                >
                    <LinearGradient
                        colors={theme.colors.error.gradient as [string, string]}
                        style={styles.actionButtonGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Ionicons name="arrow-up" size={24} color="white" />
                    </LinearGradient>
                    <Text style={styles.actionButtonText}>Send</Text>
                </TouchableOpacity>

                {/* History Button */}
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={onHistory}
                    activeOpacity={0.7}
                >
                    <LinearGradient
                        colors={theme.colors.primary.gradient as [string, string]}
                        style={styles.actionButtonGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Ionicons name="time" size={24} color="white" />
                    </LinearGradient>
                    <Text style={styles.actionButtonText}>History</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: theme.spacing[4],
        marginTop: -theme.spacing[8], // Overlap with header
        marginBottom: theme.spacing[4],
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing[4],
        ...theme.shadows.lg,
    },
    actionButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionButtonGradient: {
        width: 56,
        height: 56,
        borderRadius: theme.borderRadius.full,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing[2],
        shadowColor: theme.shadows.md.shadowColor,
        shadowOffset: theme.shadows.md.shadowOffset,
        shadowOpacity: theme.shadows.md.shadowOpacity,
        shadowRadius: theme.shadows.md.shadowRadius,
        elevation: theme.shadows.md.elevation,
    },
    actionButtonText: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
});
