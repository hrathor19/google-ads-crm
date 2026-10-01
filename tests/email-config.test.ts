import { describe, expect, it } from 'vitest';
import {
  invalidAddresses,
  isEmail,
  parseAddress,
  parseAddressList,
  renderTemplate,
} from '@/lib/email/settings';

describe('address parsing', () => {
  it('reads a bare address', () => {
    expect(parseAddress('ops@kollegeapply.com')).toEqual({ email: 'ops@kollegeapply.com' });
  });

  it('reads a display name', () => {
    expect(parseAddress('KollegeApply Ads <ads@kollegeapply.com>')).toEqual({
      email: 'ads@kollegeapply.com',
      name: 'KollegeApply Ads',
    });
  });

  it('strips the quotes around a quoted name', () => {
    expect(parseAddress('"Ads, Team" <ads@kollegeapply.com>')?.name).toBe('Ads, Team');
  });

  it('returns null rather than throwing on nonsense', () => {
    for (const bad of ['', '   ', 'not-an-email', 'a@b', '<>', '@kollegeapply.com']) {
      expect(parseAddress(bad)).toBeNull();
    }
  });

  it('splits a list on commas, semicolons and newlines', () => {
    const list = parseAddressList('a@x.com, b@x.com;c@x.com\nd@x.com');
    expect(list.map((a) => a.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  it('drops blanks and trailing separators from a list', () => {
    expect(parseAddressList('a@x.com, ,  ').map((a) => a.email)).toEqual(['a@x.com']);
  });

  it('names the malformed entries so the form can report them', () => {
    expect(invalidAddresses('a@x.com, oops, b@x.com')).toEqual(['oops']);
    expect(invalidAddresses('a@x.com, b@x.com')).toEqual([]);
    expect(invalidAddresses(null)).toEqual([]);
  });

  it('accepts a plus-addressed mailbox, which a strict pattern would reject', () => {
    expect(isEmail('ops+ads@kollegeapply.com')).toBe(true);
  });
});

describe('subject templates', () => {
  const vars = { reference: 'AR-0042', title: 'JIMS Rohini', status: 'Approved' };

  it('fills the tokens it knows', () => {
    expect(renderTemplate('{{reference}} — {{title}} is {{status}}', vars)).toBe(
      'AR-0042 — JIMS Rohini is Approved'
    );
  });

  it('tolerates spacing inside the braces', () => {
    expect(renderTemplate('{{ title }}', vars)).toBe('JIMS Rohini');
  });

  it('leaves an unknown token visible rather than blanking it', () => {
    // A typo should show up in the test mail, not silently produce a gap.
    expect(renderTemplate('{{titel}} moved', vars)).toBe('{{titel}} moved');
  });

  it('leaves a template with no tokens alone', () => {
    expect(renderTemplate('A new ad requirement', vars)).toBe('A new ad requirement');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(renderTemplate('{{title}} / {{title}}', vars)).toBe('JIMS Rohini / JIMS Rohini');
  });
});
