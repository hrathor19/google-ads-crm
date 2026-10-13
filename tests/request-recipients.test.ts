import { describe, expect, it } from 'vitest';
import {
  MAX_REQUEST_RECIPIENTS,
  describeRecipientChange,
  domainOf,
  formatRecipient,
  isEmailAddress,
  normaliseRecipients,
  parseRecipientList,
  validateRecipients,
} from '@/lib/workflow/recipients';

const COMPANY = ['kollegeapply.com'];

describe('normaliseRecipients', () => {
  it('lowercases the address, because one person is not two', () => {
    const out = normaliseRecipients([
      { email: 'Girish@KollegeApply.com' },
      { email: 'girish@kollegeapply.com' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.email).toBe('girish@kollegeapply.com');
  });

  it('keeps the order people typed, rather than sorting on save', () => {
    const out = normaliseRecipients([
      { email: 'zara@kollegeapply.com' },
      { email: 'amit@kollegeapply.com' },
    ]);
    expect(out.map((r) => r.email)).toEqual([
      'zara@kollegeapply.com',
      'amit@kollegeapply.com',
    ]);
  });

  it('keeps the first spelling of a name and drops blanks', () => {
    const out = normaliseRecipients([
      { email: 'a@kollegeapply.com', name: 'Girish Singh' },
      { email: 'a@kollegeapply.com', name: 'G. Singh' },
      { email: '   ' },
    ]);
    expect(out).toEqual([{ email: 'a@kollegeapply.com', name: 'Girish Singh' }]);
  });

  it('turns an empty name into null rather than an empty string', () => {
    expect(normaliseRecipients([{ email: 'a@kollegeapply.com', name: '  ' }])[0]!.name).toBeNull();
  });
});

describe('validateRecipients', () => {
  it('accepts a company address', () => {
    expect(validateRecipients([{ email: 'sales@kollegeapply.com' }], COMPANY)).toBeNull();
  });

  it('refuses an address outside the allowed domain, and says why', () => {
    const problem = validateRecipients([{ email: 'poc@lpu.in' }], COMPANY);
    // The reason is a policy, not a typo, so the message has to carry it:
    // these mails show the assigned budget and the required CPL.
    expect(problem).toMatch(/budget/i);
    expect(problem).toContain('poc@lpu.in');
  });

  it('treats an empty domain list as no restriction', () => {
    expect(validateRecipients([{ email: 'anyone@example.org' }], [])).toBeNull();
  });

  it('refuses something that is not an address at all', () => {
    expect(validateRecipients([{ email: 'girish' }], [])).toMatch(/not a valid email/i);
  });

  it('is not fooled by a domain that merely ends with the allowed one', () => {
    // notkollegeapply.com must not pass as kollegeapply.com, which a naive
    // `endsWith` check would wave through.
    expect(validateRecipients([{ email: 'x@notkollegeapply.com' }], COMPANY)).toMatch(
      /outside/i
    );
  });

  it('refuses a subdomain of the allowed domain', () => {
    expect(validateRecipients([{ email: 'x@mail.kollegeapply.com' }], COMPANY)).toMatch(
      /outside/i
    );
  });

  it('caps the list, so a bad paste cannot turn one request into a mailing list', () => {
    const many = Array.from({ length: MAX_REQUEST_RECIPIENTS + 1 }, (_, i) => ({
      email: `p${i}@kollegeapply.com`,
    }));
    expect(validateRecipients(many, COMPANY)).toMatch(/At most/);
  });

  it('allows exactly the maximum', () => {
    const many = Array.from({ length: MAX_REQUEST_RECIPIENTS }, (_, i) => ({
      email: `p${i}@kollegeapply.com`,
    }));
    expect(validateRecipients(many, COMPANY)).toBeNull();
  });
});

describe('parseRecipientList', () => {
  it('splits on commas, semicolons, newlines and tabs alike', () => {
    const out = parseRecipientList('a@x.com, b@x.com; c@x.com\nd@x.com\te@x.com');
    expect(out.map((r) => r.email)).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
      'e@x.com',
    ]);
  });

  it('keeps a name pasted out of a mail client', () => {
    const out = parseRecipientList('Girish Singh <girish@kollegeapply.com>');
    expect(out).toEqual([{ email: 'girish@kollegeapply.com', name: 'Girish Singh' }]);
  });

  it('strips the quotes Outlook puts round a name', () => {
    expect(parseRecipientList('"Singh, Girish" <g@x.com>')[0]!.name).toBe('Singh, Girish');
  });

  it('keeps a quoted name whole while still splitting the rest of the paste', () => {
    // The regression this guards: a comma inside "Last, First" is part of the
    // name, and splitting on it first produced two broken entries.
    const out = parseRecipientList('"Singh, Girish" <g@x.com>, amit@kollegeapply.com');
    expect(out).toEqual([
      { email: 'g@x.com', name: 'Singh, Girish' },
      { email: 'amit@kollegeapply.com', name: null },
    ]);
  });

  it('de-duplicates across a paste', () => {
    expect(parseRecipientList('a@x.com, A@X.com')).toHaveLength(1);
  });

  it('returns nothing for whitespace', () => {
    expect(parseRecipientList('   \n  ')).toEqual([]);
  });
});

describe('describeRecipientChange', () => {
  it('names who joined and who left', () => {
    const summary = describeRecipientChange(
      [{ email: 'a@x.com' }, { email: 'b@x.com' }],
      [{ email: 'b@x.com' }, { email: 'c@x.com' }]
    );
    expect(summary).toBe('added c@x.com and removed a@x.com');
  });

  it('says so when nothing moved, so an idle save writes no history', () => {
    const same = [{ email: 'a@x.com' }];
    expect(describeRecipientChange(same, same)).toBe('left the mail trail unchanged');
  });
});

describe('formatting helpers', () => {
  it('formats a named recipient for the mail header', () => {
    expect(formatRecipient({ email: 'a@x.com', name: 'Amit' })).toBe('Amit <a@x.com>');
  });

  it('falls back to the bare address', () => {
    expect(formatRecipient({ email: 'a@x.com', name: null })).toBe('a@x.com');
  });

  it('reads the domain off the last @, not the first', () => {
    expect(domainOf('odd"@"name@kollegeapply.com')).toBe('kollegeapply.com');
  });

  it('agrees with the shape check used by the email settings', () => {
    expect(isEmailAddress('a@b.co')).toBe(true);
    expect(isEmailAddress('a@b')).toBe(false);
    expect(isEmailAddress('a b@c.com')).toBe(false);
  });
});
