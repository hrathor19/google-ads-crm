import { describe, expect, it } from 'vitest';
import {
  classifyError,
  GoogleAdsAuthError,
  QuotaExceededError,
  TransientGoogleAdsError,
} from '@/lib/google-ads/client';

/**
 * This classification decides whether a failed account-month is retried or
 * thrown away, so each branch is worth asserting directly.
 */
describe('classifyError', () => {
  it('treats a dropped socket as transient so the month is retried', () => {
    // The shape Node actually produces, and the one that lost two ads
    // account-months during the historical backfill.
    const err = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      syscall: 'read',
    });
    expect(classifyError(err, '123')).toBeInstanceOf(TransientGoogleAdsError);
  });

  it.each(['ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH'])(
    'treats %s as transient',
    (code) => {
      const err = Object.assign(new Error(`socket ${code}`), { code });
      expect(classifyError(err, '123')).toBeInstanceOf(TransientGoogleAdsError);
    }
  );

  it('recognises a socket failure reported only in the message', () => {
    expect(classifyError(new Error('read ECONNRESET'), '123')).toBeInstanceOf(
      TransientGoogleAdsError
    );
  });

  it('keeps auth errors fatal — retrying cannot fix a bad token', () => {
    const err = { errors: [{ error_code: { authentication_error: 2 }, message: 'bad token' }] };
    expect(classifyError(err, '123')).toBeInstanceOf(GoogleAdsAuthError);
  });

  it('keeps quota errors out of the transient bucket', () => {
    const err = { errors: [{ error_code: { quota_error: 1 }, message: 'Too many requests' }] };
    expect(classifyError(err, '123')).toBeInstanceOf(QuotaExceededError);
  });

  it('maps gRPC RESOURCE_EXHAUSTED to a quota error', () => {
    expect(classifyError({ code: 8, message: 'exhausted' }, '123')).toBeInstanceOf(
      QuotaExceededError
    );
  });

  it.each([4, 13, 14])('maps gRPC status %i to transient', (code) => {
    expect(classifyError({ code, message: 'upstream' }, '123')).toBeInstanceOf(
      TransientGoogleAdsError
    );
  });

  it('leaves a genuine programming error fatal', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'x')");
    const out = classifyError(err, '123');
    expect(out).not.toBeInstanceOf(TransientGoogleAdsError);
    expect(out).toBeInstanceOf(TypeError);
  });
});
