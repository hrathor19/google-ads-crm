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
    // One row carrying both, rather than a row each. Counted from the
    // section's own table, which is the row after the heading.
    const body = html.slice(html.indexOf('Targeting'));
    const firstTable = body.slice(body.indexOf('<table'), body.indexOf('</table>'));
    expect((firstTable.match(/<tr>/g) ?? []).length).toBe(1);
    expect(firstTable).toContain('Location');
    expect(firstTable).toContain('Age restriction');
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
    // The value spans the three columns the two narrow pairs would use, so
    // a landing page URL is not squeezed into a quarter of the width.
    expect(html).toContain('colspan="3"');
    expect(html).toContain('https://lp.kollegeapply.com/MICA2027');
  });
});

describe('the first mail shows only what Operations typed', () => {
  it('leaves out the fields a Manager decides later', () => {
    // An "Assigned budget —" tile on this mail reads as something Ops
    // forgot, when it is a decision nobody has taken yet.
    const { html } = renderBody(
      {
        reference: 'AR-0006',
        title: 'Woxsen',
        highlights: [{ label: 'Required leads', value: '100', muted: false }],
        sections: [
          {
            heading: 'Campaign',
            rows: [{ label: 'Tracking ID', value: '1253451673' }],
          },
        ],
      },
      'Operations raised this.'
    );
    expect(html).toContain('Required leads');
    expect(html).not.toContain('Assigned budget');
    expect(html).not.toContain('Required CPL');
  });

  it('does not stretch a lone figure across the whole mail', () => {
    const one = renderBody(
      { reference: 'A', title: 'B', highlights: [{ label: 'Required leads', value: '100', muted: false }] },
      'x'
    ).html;
    const three = renderBody(
      {
        reference: 'A',
        title: 'B',
        highlights: [
          { label: 'Assigned budget', value: '₹1', muted: false },
          { label: 'Required CPL', value: '₹2', muted: false },
          { label: 'Required leads', value: '3', muted: false },
        ],
      },
      'x'
    ).html;
    // Each tile takes an equal share of the strip, so one figure fills the
    // width rather than sitting in a third of it next to two empty cells.
    expect(one).toContain('width="100%"');
    expect(three).toContain('width="33%"');
    expect(three).not.toContain('width="100%" style="width:100%;border:1px solid');
  });
});

describe('the month-by-month lead target', () => {
  const tables = [
    {
      heading: 'Month-by-month lead target',
      head: ['Month', 'Leads'],
      body: [
        ['Jan 2026', '100'],
        ['Feb 2026', '120'],
        ['Mar 2026', '150'],
      ],
      foot: ['Total', '370'],
      numeric: true,
    },
  ];

  it('renders as a real table, not a run-on line', () => {
    const { html } = renderBody({ reference: 'AR-0007', title: 'MICA', tables }, 'x');
    expect(html).toContain('Month-by-month lead target');
    for (const month of ['Jan 2026', 'Feb 2026', 'Mar 2026']) expect(html).toContain(month);
    // The thing that was missing: a header row and a total.
    expect(html).toContain('Total');
    expect(html).toContain('370');
    // Not the old flattened form.
    expect(html).not.toContain('Jan 2026: 100 ·');
  });

  it('right-aligns the figures and left-aligns the months', () => {
    const { html } = renderBody({ reference: 'AR-0007', title: 'MICA', tables }, 'x');
    expect(html).toContain('<td align="right"');
    expect(html).toContain('<td align="left"');
  });

  it('keeps its shape in the plain-text part', () => {
    const { text } = renderBody({ reference: 'AR-0007', title: 'MICA', tables }, 'x');
    expect(text).toContain('MONTH-BY-MONTH LEAD TARGET');
    // Column-aligned: every row's "Leads" column starts at the same offset.
    const lines = text.split('\n').filter((l) => /Jan 2026|Feb 2026|Total/.test(l));
    expect(lines).toHaveLength(3);
    const offsets = lines.map((l) => l.indexOf(l.trim().split(/\s{2,}/)[1] ?? ''));
    expect(new Set(offsets).size).toBe(1);
  });

  it('is left out entirely when no months were given', () => {
    const { html } = renderBody({ reference: 'AR-0007', title: 'MICA', tables: [] }, 'x');
    expect(html).not.toContain('Month-by-month');
  });
});

describe('the campaign-plan layout', () => {
  const base = {
    reference: 'AR-0006',
    title: 'CGC Jhanjheri',
    status: 'Live',
    subtitle: ['MBA, MCA', 'Delhi', 'Lead generation'],
    meta: [
      { icon: '&#128197;', label: 'Start date', value: '07 Oct 2026' },
      { icon: '&#128205;', label: 'Location', value: 'Delhi' },
    ],
    ownership: [
      { role: 'Raised by', name: 'Girish Singh' },
      { role: 'Ad Specialist', name: 'Lakshmi Rajesh Pillai' },
    ],
  };

  it('puts what, where and why under the title', () => {
    const { html } = renderBody(base, 'x');
    expect(html).toContain('MBA, MCA');
    expect(html).toContain('Lead generation');
    // Separated, not run together.
    expect(html).toMatch(/MBA, MCA[\s\S]{0,40}Delhi/);
  });

  it('names who owns it rather than leaving it to the intro', () => {
    const { html } = renderBody(base, 'x');
    expect(html).toContain('Ownership');
    expect(html).toContain('Girish Singh');
    expect(html).toContain('Lakshmi Rajesh Pillai');
  });

  it('sizes the KPI tiles to how many there are', () => {
    const five = renderBody(
      {
        ...base,
        highlights: ['a', 'b', 'c', 'd', 'e'].map((l) => ({ label: l, value: '1', muted: false })),
      },
      'x'
    ).html;
    const three = renderBody(
      {
        ...base,
        highlights: ['a', 'b', 'c'].map((l) => ({ label: l, value: '1', muted: false })),
      },
      'x'
    ).html;
    // Three tiles on the Ops mail must fill the row, not sit in a fifth of
    // it beside two empty cells.
    expect(five).toContain('width="20%"');
    expect(three).toContain('width="33%"');
  });

  it('shows the copy and says whether it is signed off', () => {
    const adCopy = {
      version: 2,
      isFinal: false,
      headlines: ['CGC Jhanjheri MBA', 'Apply Now'],
      descriptions: ['Study at CGC Jhanjheri.'],
      sitelinks: [{ text: 'Eligibility', description1: 'Entry requirements', description2: 'Check first' }],
      keywords: [{ keyword: 'cgc jhanjheri', volume: 12100 }],
    };
    const { html } = renderBody({ ...base, adCopy }, 'x');
    expect(html).toContain('CGC Jhanjheri MBA');
    expect(html).toContain('Eligibility');
    expect(html).toContain('12,100');
    // A draft must never read as approved copy.
    expect(html).toContain('draft, not yet marked final');

    const final = renderBody({ ...base, adCopy: { ...adCopy, isFinal: true } }, 'x').html;
    expect(final).toContain('final');
    expect(final).not.toContain('draft, not yet marked final');
  });

  it('leaves the copy cards out entirely when nothing has been written', () => {
    const { html } = renderBody({ ...base, adCopy: null }, 'x');
    expect(html).not.toContain('Sitelinks');
    expect(html).not.toContain('Ad copy');
  });

  it('renders the monthly plan as figures only, with no share bars', () => {
    const { html } = renderBody(
      {
        ...base,
        tables: [
          {
            heading: 'Month-by-month lead target',
            head: ['Month', 'Leads', 'Share'],
            body: [['Oct 2026', '1,100', '11%'], ['Nov 2026', '4,300', '43%']],
            foot: ['Total', '5,400', '100%'],
            numeric: true,
          },
        ],
      },
      'x'
    );
    expect(html).toContain('11%');
    expect(html).toContain('Total');
    // The share used to be drawn twice: as a percentage and as a blue bar
    // beside it. The bar was a sized table cell, so its width attribute is
    // the thing to watch for — the percentages alone must carry the shape.
    expect(html).not.toContain('width="43%"');
    expect(html).not.toContain('#3b82f6');
  });

  it('still renders with none of the new blocks supplied', () => {
    // Every one of these is optional; a mail built by an older caller must
    // not throw or come out empty.
    const { html, text } = renderBody({ reference: 'AR-0001', title: 'Plain' }, 'Something happened.');
    expect(html).toContain('Plain');
    expect(html).toContain('Something happened.');
    expect(text).toContain('Plain');
  });
});
