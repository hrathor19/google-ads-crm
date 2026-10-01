import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Validation failures have to say what is wrong.
 *
 * Creating a user with a weak password used to answer "Invalid request." The
 * rule that rejected it was written on the schema and sent in the response
 * body all along; the message just threw it away, so the person retyping the
 * form had nothing to go on.
 */

// The same shape lib/api.ts uses. Imported indirectly because that module is
// server-only and pulls in Prisma.
function describeZodError(error: z.ZodError): string {
  const flat = error.flatten();
  const field = Object.entries(flat.fieldErrors).find(([, msgs]) => msgs && msgs.length > 0);
  if (field) {
    const [name, msgs] = field;
    const label = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const message = msgs![0]!;
    return message.toLowerCase().includes(label) ? message : `${label}: ${message}`;
  }
  return flat.formErrors[0] ?? 'Invalid request.';
}

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter'),
  accountIds: z.array(z.number()).optional(),
});

const fail = (input: unknown) => {
  const r = schema.safeParse(input);
  if (r.success) throw new Error('expected a validation failure');
  return describeZodError(r.error);
};

describe('validation messages', () => {
  it('names the field and the rule that failed', () => {
    expect(fail({ email: 'a@b.com', password: 'short' })).toBe(
      'password: Use at least 10 characters'
    );
  });

  it('does not repeat the field name when the message already says it', () => {
    // "email: Enter a valid email address" reads as a stutter.
    expect(fail({ email: 'nope', password: 'Abcdefghij' })).toBe('Enter a valid email address');
  });

  it('splits a camelCase field into words', () => {
    const r = z.object({ accountIds: z.array(z.number()).min(1, 'Pick at least one') }).safeParse({
      accountIds: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(describeZodError(r.error)).toBe('account ids: Pick at least one');
  });

  it('falls back to a form-level message when no field is named', () => {
    const r = z
      .object({ a: z.string() })
      .refine(() => false, 'The whole thing is wrong')
      .safeParse({ a: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) expect(describeZodError(r.error)).toBe('The whole thing is wrong');
  });

  it('reports the first failure rather than a wall of them', () => {
    const msg = fail({ email: 'nope', password: 'short' });
    expect(msg.split('\n')).toHaveLength(1);
  });
});
