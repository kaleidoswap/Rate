/**
 * This branch builds the isolated BFA application. Jest defaults to the
 * regular app policy so its existing regression suites still exercise it.
 * BFA-specific suites mock this module to exercise the installed app policy.
 */
export const BFA_TEST_BUILD = process.env.NODE_ENV !== 'test';
