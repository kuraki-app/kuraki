export const ONBOARDING_STEPS = ['welcome', 'server', 'pair', 'permissions'] as const;

/** Keep route order and visible progress in one place. */
export function onboardingStep(segment: string | undefined) {
  const index = ONBOARDING_STEPS.findIndex((candidate) => candidate === segment);
  return {
    step: index < 0 ? 1 : index + 1,
    total: ONBOARDING_STEPS.length,
  };
}
