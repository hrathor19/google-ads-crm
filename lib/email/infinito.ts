import 'server-only';
import { randomUUID } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Transactional email through Infinito's unified API.
 *
 * Replaces Brevo, whose keys are restricted to an allowlist of IP addresses
 * — which meant every machine that ran this app, including a laptop on a
 * changing home connection, had to be registered before a single mail would
 * leave. Infinito authenticates with a client id and password and does not
 * care where the request came from.
 *
 * Two shape differences matter when reading this file:
 *
 *  - **The subject belongs to the address block, not the message.** One
 *    message can carry several address blocks, each with its own subject and
 *    recipients. We send one block per mail, so the distinction only shows
 *    up in where the field sits.
 *  - **There is no header field.** Brevo let us set `References` and
 *    `In-Reply-To` so a client would file a request's mails as one thread.
 *    Infinito exposes no equivalent, so threading now rests entirely on the
 *    shared subject line — which was always the mechanism Gmail actually
 *    used, since it normalises the subject and groups on that before it
 *    looks at any header.
 */

const ENDPOINT = 'https://api.goinfinito.com/unified/v2/send';

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
   * Kept on the type so callers do not have to know which transport is
   * wired up. Infinito accepts no custom headers, so these are dropped —
   * see the note above.
   */
  headers?: Record<string, string>;
  /** Becomes the message id, which is what the provider dedupes on. */
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

export function emailConfigured(): boolean {
  const { infinitoClientId, infinitoClientPassword } = env.email();
  return Boolean(infinitoClientId && infinitoClientPassword);
}

type InfinitoContact = { emailid: string; name?: string; seq?: string };

const contact = (a: Address): InfinitoContact => ({
  emailid: a.email,
  ...(a.name ? { name: a.name } : {}),
});

/** Turn a failure into something an operator can act on. */
function describeError(status: number, body: string): EmailSendError {
  let message = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      description?: string;
      error?: string | { message?: string };
      status?: { description?: string; code?: string };
    };
    message =
      parsed.status?.description ??
      parsed.description ??
      parsed.message ??
      (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ??
      message;
  } catch {
    // Not JSON — the raw body is the best we have.
  }

  if (status === 401 || status === 403) {
    return new EmailSendError('Infinito rejected the credentials.', status, message);
  }
  if (status === 400) {
    return new EmailSendError(
      'Infinito rejected the message.',
      status,
      `${message} The From address has to belong to a domain registered with Infinito.`
    );
  }
  if (status === 429) {
    return new EmailSendError('Infinito rate limit reached.', status, message);
  }
  return new EmailSendError(`Infinito returned ${status}: ${message}`, status);
}

/**
 * A 2xx is not necessarily an accepted message.
 *
 * The real success body is
 *   {"status":"Success","statuscode":200,"statustext":"OK",
 *    "messageack":{"guids":[{"guid":"…","submitdate":"…","id":"…"}]}}
 * so the provider's own reference is the guid, not the id we sent. That guid
 * is what support will ask for when a mail cannot be found, which is the
 * whole reason for reading the body rather than trusting the status line.
 */
function readAcceptance(body: string): { ok: boolean; id: string; detail: string } {
  try {
    const parsed = JSON.parse(body) as {
      status?: string;
      statuscode?: number;
      statustext?: string;
      description?: string;
      messageack?: { guids?: Array<{ guid?: string; id?: string }> };
    };
    const guid = parsed.messageack?.guids?.[0]?.guid ?? '';
    const detail = parsed.statustext ?? parsed.description ?? parsed.status ?? '';
    const code = parsed.statuscode;
    // Accepted unless it says otherwise. An unrecognised shape is treated as
    // success rather than failure: reporting a sent mail as failed would
    // have somebody chasing a delivery problem that does not exist.
    const rejected =
      (typeof code === 'number' && code >= 400) ||
      (typeof parsed.status === 'string' && /fail|error|reject|invalid/i.test(parsed.status));
    return { ok: !rejected, id: guid, detail };
  } catch {
    return { ok: true, id: '', detail: '' };
  }
}

export async function sendEmail(input: SendInput): Promise<{ messageId: string }> {
  const { infinitoClientId, infinitoClientPassword, infinitoDlrUrl } = env.email();
  if (!infinitoClientId || !infinitoClientPassword) {
    throw new EmailNotConfiguredError(
      'INFINITO_CLIENT_ID and INFINITO_CLIENT_PASSWORD are not set.'
    );
  }
  if (input.to.length === 0) {
    throw new EmailSendError('No recipients resolved for this mail.', 0);
  }

  const messageId = input.idempotencyKey?.trim() || randomUUID();

  const payload = {
    apiver: '1.0',
    email: {
      ver: '1.0',
      ...(infinitoDlrUrl ? { dlr: { url: infinitoDlrUrl } } : {}),
      messages: [
        {
          id: messageId,
          from: { emailid: input.from.email, name: input.from.name ?? '' },
          ...(input.replyTo
            ? {
                reply_to: {
                  emailid: input.replyTo.email,
                  name: input.replyTo.name ?? input.from.name ?? '',
                },
              }
            : {}),
          category: 'Transactional',
          // Plain part first, as every provider in this family expects: a
          // client that cannot render HTML falls back to it, and a spam
          // filter that sees HTML alone scores the mail worse.
          content: [
            { type: 'text/plain', value: input.text },
            { type: 'text/html', value: input.html },
          ],
          addresses: [
            {
              subject: input.subject,
              address_seq_id: messageId,
              to: input.to.map(contact),
              ...(input.cc?.length ? { cc: input.cc.map(contact) } : {}),
              ...(input.bcc?.length ? { bcc: input.bcc.map(contact) } : {}),
            },
          ],
        },
      ],
    },
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-client-id': infinitoClientId,
      'x-client-password': infinitoClientPassword,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) throw describeError(res.status, body);

  const accepted = readAcceptance(body);
  if (!accepted.ok) {
    throw new EmailSendError(
      `Infinito accepted the request but rejected the message: ${accepted.detail}`,
      res.status
    );
  }
  return { messageId: accepted.id || messageId };
}

/**
 * Probe for the Integrations Health page.
 *
 * There is no account endpoint to read, and sending a real mail to find out
 * whether the credentials work would put a test message in somebody's inbox
 * every time the page is opened. So this posts a deliberately invalid
 * message and reads which way it is refused: a 401 or 403 means the
 * credentials are wrong, anything else means they were accepted and the
 * request failed on its contents, which is what we want to see.
 */
export async function testEmailConnection(): Promise<{ ok: boolean; detail: string }> {
  const { infinitoClientId, infinitoClientPassword } = env.email();
  if (!infinitoClientId || !infinitoClientPassword) {
    return { ok: false, detail: 'INFINITO_CLIENT_ID / INFINITO_CLIENT_PASSWORD are not set.' };
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-client-id': infinitoClientId,
        'x-client-password': infinitoClientPassword,
        'Content-Type': 'application/json',
      },
      // No messages: enough to reach authentication, not enough to send.
      body: JSON.stringify({ apiver: '1.0', email: { ver: '1.0', messages: [] } }),
    });
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: describeError(res.status, body).message };
    }
    return {
      ok: true,
      detail: `Infinito accepted the credentials (client ${infinitoClientId.slice(0, 6)}…).`,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
