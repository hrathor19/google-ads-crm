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

  it('sends the assignment to the one Ad Specialist, not everyone who could build', () => {
    // The explicit ask. ROLE would resolve to every holder of
    // AD_REQUESTS:BUILD and put one client's brief in all their inboxes.
    expect(byEvent.REQUEST_SPECIALIST_ASSIGNED!.defaultAudience).toBe('AD_SPECIALIST');
    expect(byEvent.REQUEST_BUDGET_APPROVED!.defaultAudience).toBe('AD_SPECIALIST');
    expect(byEvent.REQUEST_APPROVED!.defaultAudience).toBe('AD_SPECIALIST');
    expect(byEvent.REQUEST_CHANGES_REQUESTED!.defaultAudience).toBe('AD_SPECIALIST');
  });

  it('sends the new requirement to whoever staffs the work', () => {
    expect(byEvent.REQUEST_SUBMITTED!.defaultAudience).toBe('ROLE');
    expect(byEvent.REQUEST_SUBMITTED!.defaultPermission).toBe('AD_REQUESTS:ASSIGN');
  });

  it('sends a rejection back to whoever raised it', () => {
    expect(byEvent.REQUEST_REJECTED!.defaultAudience).toBe('REQUESTER');
  });

  it('gives a ROLE route a permission and the others none', () => {
    for (const e of EMAIL_EVENTS) {
      if (e.defaultAudience === 'ROLE') {
        expect(e.defaultPermission, `${e.event} is ROLE with no permission`).toBeTruthy();
      } else {
        expect(e.defaultPermission, `${e.event} is ${e.defaultAudience} with a permission`).toBeNull();
      }
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
