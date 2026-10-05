import { describe, expect, it } from 'vitest';
import { isAllowedDomain } from '@/lib/auth';

/**
 * The domain gate on Google sign-in.
 *
 * Google's consent screen can also be set to Internal, but that is a toggle
 * in a console this app cannot read — if somebody flips it to External,
 * this function is the only thing standing between a personal gmail account
 * and the dashboard. It is checked on the server, in the `signIn` callback,
 * not in the button that starts the flow.
 *
 * `AUTH_ALLOWED_DOMAINS=kollegeapply.com` for these, from `.env`.
 */
describe('which addresses may sign in with Google', () => {
  it('admits a company address', () => {
    expect(isAllowedDomain('himanshu.rathore@kollegeapply.com')).toBe(true);
  });

  it('is case insensitive, because Google is not consistent about it', () => {
    expect(isAllowedDomain('Himanshu.Rathore@KollegeApply.com')).toBe(true);
  });

  it('refuses a personal address', () => {
    expect(isAllowedDomain('someone@gmail.com')).toBe(false);
  });

  it('refuses a lookalike domain', () => {
    // The ones that actually get used in an attack.
    for (const email of [
      'attacker@kollegeapply.com.evil.com',
      'attacker@notkollegeapply.com',
      'attacker@kollegeapply.co',
      'attacker@xkollegeapply.com',
    ]) {
      expect(isAllowedDomain(email), email).toBe(false);
    }
  });

  it('is not fooled by the domain appearing earlier in the address', () => {
    // `includes()` rather than an exact match on the part after the last @
    // would admit both of these.
    expect(isAllowedDomain('kollegeapply.com@gmail.com')).toBe(false);
    expect(isAllowedDomain('a@b.com@gmail.com')).toBe(false);
  });

  it('refuses something that is not an address at all', () => {
    expect(isAllowedDomain('')).toBe(false);
    expect(isAllowedDomain('no-at-sign')).toBe(false);
  });

  it('takes the domain after the last @, as the spec does', () => {
    expect(isAllowedDomain('odd"name"@kollegeapply.com')).toBe(true);
  });
});
