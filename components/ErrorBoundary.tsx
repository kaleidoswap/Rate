// components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';
import ErrorHandlingService from '../services/ErrorHandlingService';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: ErrorInfo, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private errorHandler: ErrorHandlingService;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
    this.errorHandler = ErrorHandlingService.getInstance();
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to error handling service
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo,
    });

    // Parse and log error
    this.errorHandler.parseError(error, 'ErrorBoundary');
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback && this.state.error && this.state.errorInfo) {
        return this.props.fallback(this.state.error, this.state.errorInfo, this.handleReset);
      }

      // Default error UI
      return (
        <View style={styles.container}>
          <LinearGradient
            colors={['#EF4444', '#DC2626']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.iconContainer}>
              <Ionicons name="alert-circle" size={64} color="white" />
            </View>
            <Text style={styles.title}>Something Went Wrong</Text>
            <Text style={styles.subtitle}>
              The app encountered an unexpected error
            </Text>
          </LinearGradient>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Error Details</Text>
              <Text style={styles.errorMessage}>
                {this.state.error?.message || 'Unknown error'}
              </Text>
              
              {__DEV__ && this.state.errorInfo && (
                <View style={styles.stackTrace}>
                  <Text style={styles.stackTraceTitle}>Stack Trace:</Text>
                  <ScrollView style={styles.stackTraceScroll} nestedScrollEnabled>
                    <Text style={styles.stackTraceText}>
                      {this.state.errorInfo.componentStack}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={this.handleReset}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={20} color="white" />
                <Text style={styles.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>

              <Text style={styles.helpText}>
                If this problem persists, please restart the app or contact support.
              </Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: theme.spacing[6],
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: theme.spacing[4],
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: 'white',
    marginBottom: theme.spacing[2],
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.typography.fontSize.base,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    marginTop: -20,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    backgroundColor: theme.colors.surface.primary,
  },
  contentContainer: {
    padding: theme.spacing[6],
  },
  errorCard: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[5],
    marginBottom: theme.spacing[6],
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.error[500],
  },
  errorTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
  },
  errorMessage: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    lineHeight: 24,
  },
  stackTrace: {
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  stackTraceTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
    marginBottom: theme.spacing[2],
  },
  stackTraceScroll: {
    maxHeight: 200,
  },
  stackTraceText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  actions: {
    alignItems: 'center',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.primary[500],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[8],
    borderRadius: theme.borderRadius.lg,
    width: '100%',
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: 'white',
  },
  helpText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    textAlign: 'center',
    marginTop: theme.spacing[4],
    lineHeight: 20,
  },
});

export default ErrorBoundary;

