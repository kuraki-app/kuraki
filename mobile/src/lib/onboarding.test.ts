import { describe, expect, it } from 'vitest';

import { onboardingStep } from '@/lib/onboarding';

describe('onboardingStep', () => {
  it('maps the setup route order to visible progress', () => {
    expect(onboardingStep('welcome')).toEqual({ step: 1, total: 4 });
    expect(onboardingStep('pair')).toEqual({ step: 3, total: 4 });
    expect(onboardingStep('permissions')).toEqual({ step: 4, total: 4 });
  });

  it('starts safely when the route is not ready yet', () => {
    expect(onboardingStep(undefined)).toEqual({ step: 1, total: 4 });
  });
});
