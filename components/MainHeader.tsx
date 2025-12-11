
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme';

const statusBarHeight = StatusBar.currentHeight || 0;

interface MainHeaderProps {
    title?: string;
    subtitle?: string;
    greeting?: string; // For Dashboard
    showLogo?: boolean;
    showNotification?: boolean;
    showSettings?: boolean;
    rightAction?: React.ReactNode;
    icon?: keyof typeof Ionicons.glyphMap;
    onBack?: () => void;
    children?: React.ReactNode;
}

export const MainHeader: React.FC<MainHeaderProps> = ({
    title,
    subtitle,
    greeting,
    showLogo,
    showNotification,
    showSettings,
    rightAction,
    icon,
    onBack,
    children,
}) => {
    const navigation = useNavigation<any>();

    return (
        <View style={styles.headerContainer}>
            <StatusBar barStyle="light-content" />
            <LinearGradient
                colors={theme.colors.primary.gradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerGradient}
            >
                <SafeAreaView style={styles.headerSafeArea} edges={['top', 'left', 'right']}>
                    <View style={styles.headerContent}>
                        <View style={styles.headerTop}>
                            {onBack && (
                                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                                    <Ionicons name="arrow-back" size={24} color={theme.colors.text.inverse} />
                                </TouchableOpacity>
                            )}

                            <View style={styles.headerLeft}>
                                {greeting && (
                                    <Text style={styles.greeting}>{greeting}</Text>
                                )}

                                <View style={styles.titleRow}>
                                    {icon && (
                                        <Ionicons name={icon} size={24} color={theme.colors.text.inverse} style={styles.icon} />
                                    )}
                                    {title && (
                                        <Text style={styles.headerTitle}>{title}</Text>
                                    )}
                                </View>

                                {subtitle && (
                                    <Text style={styles.headerSubtitle}>{subtitle}</Text>
                                )}
                            </View>

                            <View style={styles.headerActions}>
                                {rightAction}

                                {showNotification && (
                                    <TouchableOpacity
                                        style={styles.headerActionButton}
                                        onPress={() => navigation.navigate('Notifications')}
                                    >
                                        <Ionicons name="notifications-outline" size={20} color={theme.colors.text.inverse} />
                                        <View style={styles.notificationDot} />
                                    </TouchableOpacity>
                                )}

                                {showSettings && (
                                    <TouchableOpacity
                                        style={styles.headerActionButton}
                                        onPress={() => navigation.navigate('Settings')}
                                    >
                                        <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text.inverse} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>

                        {children && (
                            <View style={styles.headerChildren}>
                                {children}
                            </View>
                        )}
                    </View>
                </SafeAreaView>
            </LinearGradient>
        </View>
    );
};

const styles = StyleSheet.create({
    headerContainer: {
        marginBottom: theme.spacing[4],
    },
    headerGradient: {
        paddingBottom: theme.spacing[6],
        borderBottomLeftRadius: theme.borderRadius['3xl'],
        borderBottomRightRadius: theme.borderRadius['3xl'],
        // Ensure padding for status bar on Android if strictly needed, 
        // but SafeAreaView usually handles it. 
        // If translucent status bar is used, top padding might be needed.
    },
    headerSafeArea: {
        backgroundColor: 'transparent',
    },
    headerContent: {
        paddingHorizontal: theme.spacing[4],
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: theme.spacing[2],
    },
    headerLeft: {
        flex: 1,
        justifyContent: 'center',
    },
    backButton: {
        marginRight: theme.spacing[3],
    },
    greeting: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.inverse,
        opacity: 0.8,
        marginBottom: 4,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
    },
    icon: {
        opacity: 0.9,
    },
    headerTitle: {
        fontSize: theme.typography.fontSize['2xl'],
        fontWeight: '700',
        color: theme.colors.text.inverse,
    },
    headerSubtitle: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.inverse,
        opacity: 0.8,
        marginTop: 2,
        fontWeight: '500',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[3],
        marginLeft: theme.spacing[4],
    },
    headerActionButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    notificationDot: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.error[500],
        borderWidth: 1,
        borderColor: theme.colors.primary[600],
    },
    headerChildren: {
        marginTop: theme.spacing[4],
    },
});
