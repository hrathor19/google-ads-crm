import { describe, expect, it } from 'vitest';
import {
  MAX_CONTACTS_PER_IMPORT,
  nameFromEmail,
  parseContactCsv,
} from '@/lib/contacts/csv';

describe('parseContactCsv', () => {
  it('reads a Name,Email file', () => {
    const r = parseContactCsv('Name,Email\nGirish Singh,girish@kollegeapply.com');
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([{ name: 'Girish Singh', email: 'girish@kollegeapply.com' }]);
  });

  it('accepts the header spellings people actually use', () => {
    for (const header of ['Full Name,E-Mail', 'contact name,email address', 'NAME,Email ID']) {
      const r = parseContactCsv(`${header}\nAmit Rao,amit@kollegeapply.com`);
      expect(r.error, header).toBeNull();
      expect(r.rows[0]!.email, header).toBe('amit@kollegeapply.com');
    }
  });

  it('reads a file with no header row at all', () => {
    const r = parseContactCsv('Girish Singh,girish@kollegeapply.com\nAmit Rao,amit@kollegeapply.com');
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => x.email)).toEqual([
      'girish@kollegeapply.com',
      'amit@kollegeapply.com',
    ]);
  });

  it('does not care which column the address is in', () => {
    const r = parseContactCsv('girish@kollegeapply.com,Girish Singh');
    expect(r.rows).toEqual([{ name: 'Girish Singh', email: 'girish@kollegeapply.com' }]);
  });

  it('lowercases the address, so one person cannot be imported twice', () => {
    const r = parseContactCsv(
      'Name,Email\nGirish,Girish@KollegeApply.com\nGirish again,girish@kollegeapply.com'
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.email).toBe('girish@kollegeapply.com');
    expect(r.skipped[0]!.reason).toMatch(/already listed/i);
  });

  it('names every row it refuses, with its line number', () => {
    const r = parseContactCsv(
      'Name,Email\nGood,good@kollegeapply.com\nBad,not-an-address\nNoAddress,'
    );
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([
      { line: 3, value: 'not-an-address', reason: 'Not a valid email address.' },
      { line: 4, value: 'NoAddress', reason: 'No email address in this row.' },
    ]);
  });

  it('invents a readable name when the file has only addresses', () => {
    const r = parseContactCsv('Email\ngirish.singh@kollegeapply.com');
    expect(r.rows[0]!.name).toBe('Girish Singh');
  });

  it('refuses an empty file rather than importing nothing silently', () => {
    expect(parseContactCsv('   ').error).toMatch(/empty/i);
  });

  it('explains itself when every row is unusable', () => {
    const r = parseContactCsv('Name,Email\nA,nope\nB,also-nope');
    expect(r.rows).toHaveLength(0);
    expect(r.error).toMatch(/every line was skipped/i);
    expect(r.skipped).toHaveLength(2);
  });

  it('caps a runaway paste', () => {
    const many = Array.from(
      { length: MAX_CONTACTS_PER_IMPORT + 50 },
      (_, i) => `P${i},p${i}@kollegeapply.com`
    ).join('\n');
    expect(parseContactCsv(`Name,Email\n${many}`).rows).toHaveLength(MAX_CONTACTS_PER_IMPORT);
  });

  it('survives trailing blank lines and stray whitespace', () => {
    const r = parseContactCsv('Name, Email \n  Girish  , girish@kollegeapply.com \n\n\n');
    expect(r.rows).toEqual([{ name: 'Girish', email: 'girish@kollegeapply.com' }]);
  });
});

describe('nameFromEmail', () => {
  it('splits on dots, underscores and hyphens', () => {
    expect(nameFromEmail('girish.singh@x.com')).toBe('Girish Singh');
    expect(nameFromEmail('amit_rao@x.com')).toBe('Amit Rao');
    expect(nameFromEmail('zara-khan@x.com')).toBe('Zara Khan');
  });

  it('drops the digits people put on the end of an address', () => {
    expect(nameFromEmail('rahul99@x.com')).toBe('Rahul');
  });

  it('keeps a digit that is part of the word', () => {
    // Stripping every digit turned `e2e` into "E E" and would shred a real
    // address like k2consulting the same way.
    expect(nameFromEmail('e2e.import2@x.com')).toBe('E2e Import');
    expect(nameFromEmail('k2consulting@x.com')).toBe('K2consulting');
  });

  it('falls back to the address when there is nothing to read', () => {
    expect(nameFromEmail('123@x.com')).toBe('123@x.com');
  });
});
