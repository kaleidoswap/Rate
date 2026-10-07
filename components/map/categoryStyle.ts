// components/map/categoryStyle.ts
import { theme } from '../../theme';
import type { PlaceCategory } from '../../utils/btcMapPlaces';

/** Accent per place category, used for chips, list icons and map markers. */
export const CATEGORY_COLOR: Record<PlaceCategory, string> = {
  food: theme.colors.error[500],
  cafe: theme.colors.networks.lightning,
  shops: theme.colors.brand.violet,
  groceries: theme.colors.success[500],
  lodging: theme.colors.info[500],
  services: theme.colors.networks.unified,
  atm: theme.colors.networks.bitcoin,
  other: theme.colors.gray[400],
};
