// components/LoadingSkeleton.tsx
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { theme } from '../theme';

interface SkeletonProps {
  width?: number | `${number}%` | 'auto';
  height?: number;
  borderRadius?: number;
  /** Visual preset (e.g. 'text', 'circle', 'card'). Currently informational; reserved for future use. */
  variant?: 'text' | 'circle' | 'card' | 'rect';
  /** Number of skeleton rows to render. Defaults to 1. */
  count?: number;
  /** Vertical gap between rows when count > 1. Defaults to 8. */
  spacing?: number;
  style?: ViewStyle;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = 4,
  variant: _variant,
  count = 1,
  spacing = 8,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, []);

  const row = (key?: number) => (
    <Animated.View
      key={key}
      testID="loading-skeleton"
      accessibilityLabel="Loading"
      accessibilityState={{ busy: true }}
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius,
          opacity,
          marginBottom: count > 1 && key !== count - 1 ? spacing : 0,
        },
        style,
      ]}
    />
  );

  if (count <= 1) return row();
  return <View>{Array.from({ length: count }).map((_, i) => row(i))}</View>;
};

export const CardSkeleton: React.FC = () => (
  <View style={styles.cardSkeleton}>
    <Skeleton width="60%" height={24} style={styles.mb2} />
    <Skeleton width="40%" height={18} style={styles.mb3} />
    <Skeleton width="100%" height={16} style={styles.mb1} />
    <Skeleton width="80%" height={16} />
  </View>
);

export const ListItemSkeleton: React.FC = () => (
  <View style={styles.listItemSkeleton}>
    <Skeleton width={48} height={48} borderRadius={24} />
    <View style={styles.listItemContent}>
      <Skeleton width="70%" height={18} style={styles.mb1} />
      <Skeleton width="40%" height={14} />
    </View>
  </View>
);

export const BalanceCardSkeleton: React.FC = () => (
  <View style={styles.balanceCardSkeleton}>
    <Skeleton width="40%" height={16} style={styles.mb3} />
    <Skeleton width="60%" height={36} style={styles.mb2} />
    <View style={styles.row}>
      <Skeleton width="30%" height={14} style={styles.mr2} />
      <Skeleton width="30%" height={14} />
    </View>
  </View>
);

export const TransactionSkeleton: React.FC = () => (
  <View style={styles.transactionSkeleton}>
    <View style={styles.transactionLeft}>
      <Skeleton width={40} height={40} borderRadius={20} style={styles.mr3} />
      <View>
        <Skeleton width={120} height={16} style={styles.mb1} />
        <Skeleton width={80} height={12} />
      </View>
    </View>
    <View style={styles.transactionRight}>
      <Skeleton width={80} height={18} style={styles.mb1} />
      <Skeleton width={60} height={12} />
    </View>
  </View>
);

export const AssetCardSkeleton: React.FC = () => (
  <View style={styles.assetCardSkeleton}>
    <View style={styles.row}>
      <Skeleton width={56} height={56} borderRadius={28} style={styles.mr3} />
      <View style={styles.flex1}>
        <Skeleton width="60%" height={20} style={styles.mb1} />
        <Skeleton width="40%" height={14} />
      </View>
      <View style={styles.alignRight}>
        <Skeleton width={80} height={20} style={styles.mb1} />
        <Skeleton width={60} height={14} />
      </View>
    </View>
  </View>
);

export const DashboardSkeleton: React.FC = () => (
  <View style={styles.dashboardSkeleton}>
    <BalanceCardSkeleton />
    <View style={styles.section}>
      <Skeleton width="40%" height={24} style={styles.mb3} />
      <TransactionSkeleton />
      <TransactionSkeleton />
      <TransactionSkeleton />
    </View>
  </View>
);

export const ScreenSkeleton: React.FC = () => (
  <View style={styles.screenSkeleton}>
    <View style={styles.header}>
      <Skeleton width={40} height={40} borderRadius={20} />
      <Skeleton width="50%" height={24} />
      <Skeleton width={40} height={40} borderRadius={20} />
    </View>
    <View style={styles.content}>
      <CardSkeleton />
      <View style={styles.spacer} />
      <CardSkeleton />
      <View style={styles.spacer} />
      <CardSkeleton />
    </View>
  </View>
);

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: theme.colors.gray[200],
  },
  cardSkeleton: {
    backgroundColor: theme.colors.surface.primary,
    padding: theme.spacing[5],
    borderRadius: theme.borderRadius.xl,
    marginBottom: theme.spacing[3],
  },
  listItemSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[2],
  },
  listItemContent: {
    flex: 1,
    marginLeft: theme.spacing[3],
  },
  balanceCardSkeleton: {
    backgroundColor: theme.colors.surface.primary,
    padding: theme.spacing[6],
    borderRadius: theme.borderRadius.xl,
    marginBottom: theme.spacing[4],
  },
  transactionSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[2],
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  assetCardSkeleton: {
    backgroundColor: theme.colors.surface.primary,
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.xl,
    marginBottom: theme.spacing[3],
  },
  dashboardSkeleton: {
    padding: theme.spacing[4],
  },
  section: {
    marginTop: theme.spacing[4],
  },
  screenSkeleton: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
  },
  content: {
    padding: theme.spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex1: {
    flex: 1,
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  mb1: {
    marginBottom: theme.spacing[1],
  },
  mb2: {
    marginBottom: theme.spacing[2],
  },
  mb3: {
    marginBottom: theme.spacing[3],
  },
  mr2: {
    marginRight: theme.spacing[2],
  },
  mr3: {
    marginRight: theme.spacing[3],
  },
  spacer: {
    height: theme.spacing[3],
  },
});

export default Skeleton;

