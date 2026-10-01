import 'server-only';
import { env } from '@/lib/env';

/**
 * Brevo transactional email.
 *
 * The HTTP API rather than SMTP: the same credentials the Google Ads
 * Intelligence project uses, and it reports a usable error instead of
 * failing somewhere inside a socket.
 *
 * A note on the key. Brevo keys can be restricted to an allowlist of IP
 * addresses, and a blocked address returns 401 with a message naming the IP —
 * which reads exactly like a bad key but is not one. `describeError` keeps
 * that distinction, because the fix is completely different: authorise the
 * address at https://app.brevo.com/security/authorised_ips rather than
 * reissue the key. A deployed server needs its own address added too.
 */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export type Address = { email: string; name?: string };

export type SendInput = {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  replyTo?: Address;
  subject: string;
  html: string;
  text: string;
  /**
   * Threading headers. All of a request's mails carry the same References so
   * a client files them as one conversation.
   */
  headers?: Record<string, string>;
  /** Brevo dedupes on this, so a retry cannot send the same mail twice. */
  idempotencyKey?: string;
};

export class EmailNotConfiguredError extends Error {}
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string
  ) {
    super(message);
  }
}

export function brevoConfigured(): boolean {
  return Boolean(env.email().brevoApiKey);
}

/** Turn a Brevo failure into something an operator can act on. */
function describeError(status: number, body: string): EmailSendError {
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string; code?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    // Not JSON — the raw body is the best we have.
  }

  // An IP-restricted key fails with 401 and names the address. Reissuing the
  // key would not help; the address has to be authorised.
  // `[\d.]+` would swallow the sentence's full stop and report
  // "14.195.217.70." as the address, which is not one anyone can paste
  // into Brevo's allowlist.
  const ip = /unrecognised IP address ([0-9a-fA-F:.]*[0-9a-fA-F:])/.exec(message)?.[1];
  if (status === 401 && ip) {
    return new EmailSendError(
      `Brevo rejected this server's IP address (${ip}).`,
      status,
      `The API key is valid but restricted. Authorise ${ip} at ` +
        'https://app.brevo.com/security/authorised_ips, or remove the ' +
        'restriction. A deployed server needs its own address added too.'
    );
  }
  if (status === 401) {
    return new EmailSendError('Brevo rejected the API key.', status, message);
  }
  if (status === 400 && /sender/i.test(message)) {
    return new EmailSendError(
      'Brevo rejected the sender address.',
      status,
      'The From address has to be a verified sender on the Brevo account.'
    );
  }
  if (status === 429) {
    return new EmailSendError('Brevo rate limit reached.', status, message);
  }
  return new EmailSendError(`Brevo returned ${status}: ${message}`, status);
}

export async function sendViaBrevo(input: SendInput): Promise<{ messageId: string }> {
  const { brevoApiKey } = env.email();
  if (!brevoApiKey) throw new EmailNotConfiguredError('BREVO_API_KEY is not set.');
  if (input.to.length === 0) {
    throw new EmailSendError('No recipients resolved for this mail.', 0);
  }

  const payload: Record<string, unknown> = {
    sender: input.from,
    to: input.to,
    subject: input.subject,
    htmlContent: input.html,
    textContent: input.text,
  };
  if (input.cc?.length) payload.cc = input.cc;
  if (input.bcc?.length) payload.bcc = input.bcc;
  if (input.replyTo) payload.replyTo = input.replyTo;
  if (input.headers && Object.keys(input.headers).length) payload.headers = input.headers;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) throw describeError(res.status, body);

  let messageId = '';
  try {
    messageId = (JSON.parse(body) as { messageId?: string }).messageId ?? '';
  } catch {
    // A 2xx with an unreadable body still means it was accepted.
  }
  return { messageId };
}

/** Probe for the Integrations Health page: does the key work from here? */
export async function testBrevoConnection(): Promise<{ ok: boolean; detail: string }> {
  const { brevoApiKey } = env.email();
  if (!brevoApiKey) return { ok: false, detail: 'BREVO_API_KEY is not set.' };
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': brevoApiKey, accept: 'application/json' },
    });
    const body = await res.text();
    if (!res.ok) {
      const err = describeError(res.status, body);
      return { ok: false, detail: err.hint ? `${err.message} ${err.hint}` : err.message };
    }
    const account = JSON.parse(body) as { email?: string };
    return { ok: true, detail: `Connected as ${account.email ?? 'the Brevo account'}.` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
