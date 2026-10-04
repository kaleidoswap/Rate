import { StyleSheet } from 'react-native';
import type { ThemeType } from '../../theme';

export const createReceiveStyles = (theme: ThemeType) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },

  scrollView: {
    flex: 1,
    zIndex: 0,
  },

  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[10],
  },

  errorContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },

  errorText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
    lineHeight: 22,
  },

  promptContainer: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[8],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6.27,
    elevation: 10,
  },

  promptText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
    lineHeight: 22,
  },

  retryButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },

  retryButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },

  generateButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },

  generateButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },

  // QR Section
  assetTabs: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    zIndex: 20,
    elevation: 20,
  },
  assetTab: {
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing[2],
    minHeight: 44,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetTabText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    flexShrink: 1,
  },
  addrListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
  },
  addrLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  qrSection: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    alignItems: 'center',
    zIndex: 0,
  },

  qrContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },

  // Top bar above the QR (title on the left, small refresh on the right)
  qrTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    minHeight: 42,
  },
  qrRefreshBtn: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  qrStreamHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[2],
    paddingLeft: theme.spacing[1],
  },
  qrStreamHintText: {
    fontSize: 11,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  universalRequestTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  universalRequestSubtitle: {
    fontSize: 11,
    color: theme.colors.text.secondary,
    marginTop: 2,
  },

  // Asset "+" tab (square add button)
  assetAddTab: {
    width: 44,
    minHeight: 44,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Amount row with pencil edit
  amountRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  amountRowLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },
  amountRowValue: {
    fontSize: theme.typography.fontSize.xl,
    color: theme.colors.text.primary,
    marginTop: 2,
  },
});
