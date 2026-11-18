import { useAppSelector } from '../store/hooks';
import { isFeatureOn, type Feature } from '../services/features';

/** Whether a feature is shipped by this build and turned on. */
export function useFeature(feature: Feature): boolean {
  return useAppSelector(state => isFeatureOn(feature, state.settings?.labs));
}
