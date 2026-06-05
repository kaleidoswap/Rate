/**
 * Single source of truth for payment / transfer / swap status display.
 *
 * Previously each screen humanized statuses its own way (HistoryScreen had a
 * 3-state map; SwapScreen rendered raw `status.toUpperCase()` so users saw
 * "WHITELISTED" / "EXECUTING"). This centralizes status → { label, color } and,
 * crucially, gives every multi-step swap state an honest, human-readable label.
 * Unknown statuses fall back to a neutral colour + humanized text rather than a
 * misleading green/red — so a stuck or unexpected state never masquerades as
 * success or failure.
 */
import { theme } from '../theme';

export type ActivityStatus = 'confirmed' | 'pending' | 'failed';

// Full Kaleidoswap atomic-swap lifecycle (3-step: init → taker → execute).
export type SwapExecutionStatus =
  | 'pending'
  | 'whitelisted'
  | 'executing'
  | 'completed'
  | 'failed';

export interface StatusVisual {
  label: string;
  color: string;
}

export const ACTIVITY_STATUS_VISUAL: Record<ActivityStatus, StatusVisual> = {
  confirmed: { label: 'Confirmed', color: theme.colors.success[500] },
  pending: { label: 'Pending', color: theme.colors.warning[500] },
  failed: { label: 'Failed', color: theme.colors.error[500] },
};

const SWAP_STATUS_VISUAL: Record<SwapExecutionStatus, StatusVisual> = {
  pending: { label: 'Requested', color: theme.colors.warning[500] },
  whitelisted: { label: 'Preparing channels', color: theme.colors.warning[500] },
  executing: { label: 'Swapping', color: theme.colors.info[500] },
  completed: { label: 'Completed', color: theme.colors.success[500] },
  failed: { label: 'Failed', color: theme.colors.error[500] },
};

/** Turn a raw status token into Title-Case words ("transfer_returned" → "Transfer returned"). */
export function humanizeStatus(status?: string): string {
  if (!status) return 'Unknown';
  const cleaned = status.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!cleaned) return 'Unknown';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function activityStatusVisual(status: ActivityStatus | string): StatusVisual {
  return (
    ACTIVITY_STATUS_VISUAL[status as ActivityStatus] ?? {
      label: humanizeStatus(status),
      color: theme.colors.text.tertiary,
    }
  );
}

export function swapStatusVisual(status?: string): StatusVisual {
  return (
    SWAP_STATUS_VISUAL[status as SwapExecutionStatus] ?? {
      label: humanizeStatus(status),
      color: theme.colors.text.tertiary,
    }
  );
}
