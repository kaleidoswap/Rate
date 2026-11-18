import { useAppSelector } from '../store/hooks';
import { selectFeatureOn } from '../store/slices/settingsSlice';
import type { Feature } from '../services/features';

/** Whether a feature is shipped by this build and turned on. */
export function useFeature(feature: Feature): boolean {
  return useAppSelector(state => selectFeatureOn(state, feature));
}
