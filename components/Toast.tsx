// components/Toast.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import ToastService, { Toast as ToastType, ToastPosition } from '../services/ToastService';

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const translateY = new Animated.Value(toast.position === 'top' ? -100 : 100);
  const opacity = new Animated.Value(0);

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const animateOut = (callback: () => void) => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: toast.position === 'top' ? -100 : 100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(callback);
  };

  const handleDismiss = () => {
    animateOut(() => {
      onDismiss(toast.id);
    });
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'close-circle';
      case 'warning':
        return 'warning';
      case 'info':
        return 'information-circle';
      default:
        return 'information-circle';
    }
  };

  const getColors = () => {
    switch (toast.type) {
      case 'success':
        return {
          background: theme.colors.success[50],
          border: theme.colors.success[500],
          icon: theme.colors.success[500],
          text: theme.colors.success[900] || theme.colors.success[800],
        };
      case 'error':
        return {
          background: theme.colors.error[50],
          border: theme.colors.error[500],
          icon: theme.colors.error[500],
          text: theme.colors.error[900] || theme.colors.error[800],
        };
      case 'warning':
        return {
          background: theme.colors.warning[50],
          border: theme.colors.warning[500],
          icon: theme.colors.warning[500],
          text: theme.colors.warning[900] || theme.colors.warning[800],
        };
      case 'info':
        return {
          background: theme.colors.info[50],
          border: theme.colors.info[500],
          icon: theme.colors.info[500],
          text: theme.colors.info[900] || theme.colors.info[800],
        };
      default:
        return {
          background: theme.colors.gray[100],
          border: theme.colors.gray[400],
          icon: theme.colors.gray[600],
          text: theme.colors.gray[900],
        };
    }
  };

  const colors = getColors();
  const containerStyle = toast.position === 'top' ? styles.containerTop : styles.containerBottom;

  return (
    <Animated.View
      testID="toast-container"
      style={[
        containerStyle,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <SafeAreaView edges={toast.position === 'top' ? ['top'] : ['bottom']}>
        <View
          style={[
            styles.toast,
            {
              backgroundColor: colors.background,
              borderLeftColor: colors.border,
            },
          ]}
        >
          <Ionicons name={getIcon()} size={24} color={colors.icon} style={styles.icon} />

          <Text style={[styles.message, { color: colors.text }]} numberOfLines={3}>
            {toast.message}
          </Text>

          {toast.action && (
            <TouchableOpacity
              testID="toast-action-button"
              style={[styles.actionButton, { borderColor: colors.border }]}
              onPress={() => {
                toast.action?.onPress();
                handleDismiss();
              }}
            >
              <Text style={[styles.actionText, { color: colors.icon }]}>
                {toast.action.label}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity testID="toast-close-button" style={styles.closeButton} onPress={handleDismiss}>
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
};

export const ToastContainer: React.FC = () => {
  const [activeToast, setActiveToast] = useState<ToastType | null>(null);

  useEffect(() => {
    const toastService = ToastService.getInstance();

    const unsubscribe = toastService.subscribe((toast) => {
      setActiveToast(toast);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleDismiss = (id: string) => {
    ToastService.getInstance().dismiss(id);
    setActiveToast(null);
  };

  if (!activeToast) {
    return null;
  }

  return <ToastItem toast={activeToast} onDismiss={handleDismiss} />;
};

const styles = StyleSheet.create({
  containerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  containerBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing[4],
    marginVertical: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  icon: {
    marginRight: theme.spacing[3],
  },
  message: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    lineHeight: 20,
  },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    marginLeft: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
  },
  closeButton: {
    padding: theme.spacing[1],
    marginLeft: theme.spacing[2],
  },
});

export default ToastContainer;

