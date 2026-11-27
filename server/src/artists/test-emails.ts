// An email address of 200,003 characters, whose format alone would take seconds to check (see `isEmailAddress` in
// artists/profile.ts), for tests that check it's refused right away.
export const LONG_EMAIL = `a@${'a.'.repeat(100_000)}@`
