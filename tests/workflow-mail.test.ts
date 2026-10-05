import { describe, expect, it } from 'vitest';
import { mailEventFor } from '@/lib/email/workflow-mail';
import { EMAIL_EVENTS } from '@/lib/email/settings';
import { renderBody } from '@/lib/email/send';
import { TRANSITIONS } from '@/lib/workflow/state-machine';

/**
 * Which step mails whom.
 *
 * The addressing is the part worth pinning: a wrong audience here sends one
 * client's budget to every Ad Specialist, and nothing in the app would show
 * that it had happened.
 */

describe('the five mails the flow sends', () => {
  it('maps each step people asked to be told about', () => {
    expect(mailEventFor('SUBMITTED')).toBe('REQUEST_SUBMITTED');
    expect(mailEventFor('AM_ASSIGNED')).toBe('REQUEST_SPECIALIST_ASSIGNED');
    expect(mailEventFor('BUDGET_APPROVED')).toBe('REQUEST_BUDGET_APPROVED');
    expect(mailEventFor('ADS_SUBMITTED')).toBe('REQUEST_ADS_SUBMITTED');
    expect(mailEventFor('REVIEW_APPROVED')).toBe('REQUEST_APPROVED');
    expect(mailEventFor('LIVE')).toBe('REQUEST_LIVE');
  });

  it('mails both review outcomes, which carry the remark', () => {
    expect(mailEventFor('RECHECK_REQUESTED')).toBe('REQUEST_CHANGES_REQUESTED');
    expect(mailEventFor('REJECTED')).toBe('REQUEST_REJECTED');
  });

  it('sends nothing for the states the system passes through on its own', () => {
    // These auto-advance inside the same transaction as the step before
    // them. Mailing on both would send every notification twice.
    for (const status of ['AWAITING_AM_ASSIGNMENT', 'AWAITING_AD_SUBMISSION', 'UNDER_REVIEW'] as const) {
      expect(mailEventFor(status)).toBeNull();
    }
  });

  it('has a configurable route for every event it can fire', () => {
    const configured = new Set(EMAIL_EVENTS.map((e) => e.event));
    for (const t of TRANSITIONS) {
      const event = mailEventFor(t.to);
      if (!event) continue;
      expect(configured.has(event), `${t.to} fires ${event}, which has no route`).toBe(true);
    }
  });
});

describe('who each mail goes to by default', () => {
  const byEvent = Object.fromEntries(EMAIL_EVENTS.map((e) => [e.event, e]));
  const to = (event: string) => byEvent[event]!.defaultTo;
  const cc = (event: string) => byEvent[event]!.defaultCc;

  it('tells the Manager when Operations raises a requirement', () => {
    expect(to('REQUEST_SUBMITTED')).toEqual(['MANAGER']);
  });

  it('tells both the requester and the one person doing the work, on assignment', () => {
    // Not everyone who *could* have been picked: AD_SPECIALIST resolves to
    // the one named on this request.
    expect(to('REQUEST_SPECIALIST_ASSIGNED')).toEqual(['REQUESTER', 'AD_SPECIALIST']);
    expect(cc('REQUEST_SPECIALIST_ASSIGNED')).toEqual(['MANAGER']);
  });

  it('sends the ad copy to the Manager, copying whoever raised it', () => {
    expect(to('REQUEST_ADS_SUBMITTED')).toEqual(['MANAGER']);
    expect(cc('REQUEST_ADS_SUBMITTED')).toEqual(['REQUESTER']);
  });

  it('tells the requester and the specialist when the review passes', () => {
    expect(to('REQUEST_APPROVED')).toEqual(['REQUESTER', 'AD_SPECIALIST']);
  });

  it('tells the Manager when it goes live', () => {
    expect(to('REQUEST_LIVE')).toEqual(['MANAGER']);
  });

  it('addresses a recheck to whoever has to act on it', () => {
    // The Specialist does the work; the reviewer who asked and the Manager
    // watching the round count are copied.
    expect(to('REQUEST_CHANGES_REQUESTED')).toEqual(['AD_SPECIALIST']);
    expect(cc('REQUEST_CHANGES_REQUESTED')).toEqual(['REQUESTER', 'MANAGER']);
  });

  it('sends a rejection to the person whose request it was', () => {
    // Copying the Specialist matters: a rejection at review means stop
    // building, and they would otherwise carry on.
    expect(to('REQUEST_REJECTED')).toEqual(['REQUESTER']);
    expect(cc('REQUEST_REJECTED')).toContain('AD_SPECIALIST');
  });

  it('never leaves a rule with nobody in To', () => {
    for (const e of EMAIL_EVENTS) {
      expect(e.defaultTo.length, `${e.event} has an empty To`).toBeGreaterThan(0);
    }
  });

  it('never copies somebody who is already in To', () => {
    for (const e of EMAIL_EVENTS) {
      const overlap = e.defaultCc.filter((r) => e.defaultTo.includes(r));
      expect(overlap, `${e.event} has ${overlap.join(', ')} in both`).toEqual([]);
    }
  });
});

describe('the rendered mail', () => {
  const base = { reference: 'AR-0001', title: 'MBA Admissions 2027' };

  it('shows budget and CPL as unset rather than hiding the rows', () => {
    // The first mail goes out before anyone has decided. A missing line
    // reads as an oversight; an em dash reads as "not yet".
    const { html, text } = renderBody(
      {
        ...base,
        highlights: [
          { label: 'Assigned budget', value: '—', muted: true },
          { label: 'Required CPL', value: '—', muted: true },
        ],
      },
      'Operations raised this requirement.'
    );
    expect(html).toContain('Assigned budget');
    expect(html).toContain('Required CPL');
    expect(text).toContain('Assigned budget: —');
  });

  it('shows them filled once a Manager has set them', () => {
    const { text } = renderBody(
      {
        ...base,
        highlights: [
          { label: 'Assigned budget', value: '₹2,50,000', muted: false },
          { label: 'Required CPL', value: '₹2,500', muted: false },
        ],
      },
      'The budget was approved.'
    );
    expect(text).toContain('Assigned budget: ₹2,50,000');
    expect(text).toContain('Required CPL: ₹2,500');
  });

  it('quotes the recheck remark under its own heading', () => {
    const { html, text } = renderBody(
      { ...base, reason: 'Tighten the headlines to 30 characters.', reasonLabel: 'What needs changing' },
      'Sent back for a recheck.'
    );
    expect(html).toContain('What needs changing');
    expect(html).toContain('Tighten the headlines');
    expect(text).toContain('What needs changing: Tighten the headlines to 30 characters.');
  });

  it('escapes a campaign name that looks like markup', () => {
    // Titles come from whatever Ops typed and whatever Google returns.
    const { html } = renderBody(
      { reference: 'AR-0002', title: '<script>alert(1)</script>' },
      'Raised.'
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the brief in sections', () => {
    const { html, text } = renderBody(
      {
        ...base,
        sections: [
          { heading: 'Campaign', rows: [{ label: 'Tracking ID', value: '13000047' }] },
          { heading: 'Timing', rows: [{ label: 'Start date', value: '02 Oct 2026' }] },
        ],
      },
      'Raised.'
    );
    expect(html).toContain('Campaign');
    expect(html).toContain('13000047');
    expect(text).toContain('CAMPAIGN');
    expect(text).toContain('  Start date: 02 Oct 2026');
  });

  it('leaves out the button when there is no absolute link', () => {
    // A relative href in an email client goes nowhere.
    const { html } = renderBody({ ...base }, 'Raised.');
    expect(html).not.toContain('Open the request');
  });
});

// ─── Threading ──────────────────────────────────────────────────────────────

describe('keeping one request in one mail trail', () => {
  it('puts the step in the body, where it cannot split the thread', () => {
    const { html, text } = renderBody(
      { reference: 'AR-0003', title: 'MICA', stepLine: 'Budget and CPL approved' },
      'The Manager approved the spend.'
    );
    expect(html).toContain('Budget and CPL approved');
    expect(text).toContain('>> Budget and CPL approved');
  });

  it('renders without a step label at all', () => {
    const { html } = renderBody({ reference: 'AR-0003', title: 'MICA' }, 'Raised.');
    expect(html).toContain('MICA');
  });

  it('escapes a step label as carefully as everything else', () => {
    const { html } = renderBody(
      { reference: 'AR-0003', title: 'MICA', stepLine: '<b>oops</b>' },
      'Raised.'
    );
    expect(html).not.toContain('<b>oops</b>');
    expect(html).toContain('&lt;b&gt;oops&lt;/b&gt;');
  });
});

describe('the step label inside a shared-subject thread', () => {
  it('drops the client name, which the heading already carries', () => {
    const { html, text } = renderBody(
      { reference: 'AR-0003', title: 'MICA', stepLine: 'MICA — budget and CPL approved' },
      'Approved.'
    );
    expect(html).toContain('Budget and CPL approved');
    expect(html).not.toContain('MICA — budget');
    expect(text).toContain('>> Budget and CPL approved');
  });

  it('leaves a label that does not start with the title alone', () => {
    const { html } = renderBody(
      { reference: 'AR-0003', title: 'MICA', stepLine: 'Urgent: client escalation' },
      'x'
    );
    expect(html).toContain('Urgent: client escalation');
  });

  it('keeps the label when it is nothing but the title', () => {
    // Trimming to an empty badge would lose the only thing distinguishing
    // this mail from the others in the trail.
    const { html } = renderBody(
      { reference: 'AR-0003', title: 'MICA', stepLine: 'MICA — ' },
      'x'
    );
    expect(html).toContain('MICA');
  });
});

describe('keeping the brief to one screen', () => {
  const row = (label: string, value: string, extra = {}) => ({ label, value, ...extra });

  it('drops facts nobody filled in', () => {
    const { html, text } = renderBody(
      {
        reference: 'AR-0005',
        title: 'MMU',
        sections: [
          { heading: 'Notes', rows: [row('Keywords', '—'), row('Reporting panel', 'NPF')] },
        ],
      },
      'x'
    );
    expect(html).toContain('Reporting panel');
    expect(html).not.toContain('Keywords');
    expect(text).not.toContain('Keywords');
  });

  it('keeps a blank the reader is specifically checking for', () => {
    // The budget is deliberately empty in the first mail. Hiding it would
    // read as "not asked for" rather than "not decided yet".
    const { html } = renderBody(
      {
        reference: 'AR-0005',
        title: 'MMU',
        sections: [{ heading: 'People', rows: [row('Manager', '—', { always: true })] }],
      },
      'x'
    );
    expect(html).toContain('Manager');
  });

  it('drops a section that ends up with nothing in it', () => {
    const { html } = renderBody(
      {
        reference: 'AR-0005',
        title: 'MMU',
        sections: [{ heading: 'Destinations', rows: [row('KAPP LP', '—')] }],
      },
      'x'
    );
    expect(html).not.toContain('Destinations');
  });

  it('pairs two facts onto one line', () => {
    const { html } = renderBody(
      {
        reference: 'AR-0005',
        title: 'MMU',
        sections: [
          { heading: 'Targeting', rows: [row('Location', 'Delhi'), row('Age restriction', 'Open')] },
        ],
      },
      'x'
    );
    // One row carrying both, rather than a row each.
    const body = html.slice(html.indexOf('Targeting'));
    expect((body.match(/<tr>/g) ?? []).length).toBe(1);
  });

  it('gives a long value the whole width', () => {
    const { html } = renderBody(
      {
        reference: 'AR-0005',
        title: 'MMU',
        sections: [
          {
            heading: 'Destinations',
            rows: [row('All destinations', 'https://lp.kollegeapply.com/MICA2027', { wide: true })],
          },
        ],
      },
      'x'
    );
    expect(html).toContain('colspan="2"');
  });
});
