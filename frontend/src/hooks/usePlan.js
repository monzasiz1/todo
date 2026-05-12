import { useAuthStore } from '../store/authStore';
import { canUseFeature, getLimit, getPlan } from '../lib/plans';

/**
 * usePlan()
 *
 * Returns helpers to check plan features and limits for the current user.
 *
 * Usage:
 *   const { can, limit, plan, isPro, isFree } = usePlan();
 *   if (!can('ai')) { ... show upgrade ... }
 *   if (taskCount >= limit('tasks')) { ... show upgrade ... }
 */
export function usePlan() {
  const user = useAuthStore((s) => s.user);
  const planId = user?.plan ?? 'free';
  const plan = getPlan(planId);

  return {
    planId,
    plan,
    isFree: planId === 'free',
    isPro: planId === 'pro' || planId === 'team',
    isTeam: planId === 'team',

    /** Check if the current plan includes a feature. */
    can: (featureKey) => canUseFeature(planId, featureKey),

    /** Get a numeric limit for the current plan. */
    limit: (limitKey) => getLimit(planId, limitKey),

    /** Returns true if the user is at or over a limit. */
    atLimit: (limitKey, currentCount) => {
      const max = getLimit(planId, limitKey);
      return currentCount >= max;
    },
  };
}
