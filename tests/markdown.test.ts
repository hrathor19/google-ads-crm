import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Markdown } from '@/components/data/markdown';

/**
 * The assistant's answers are written by a language model from live client
 * data — a campaign name, a search term someone typed into Google. That is
 * untrusted text arriving at a renderer, so the one property that matters is
 * that nothing in it can become markup.
 */
const render = (src: string) => renderToStaticMarkup(createElement(Markdown, { children: src }));

describe('safety', () => {
  it('escapes HTML in the model output rather than rendering it', () => {
    const html = render('Spend is up <script>alert(1)</script> this week.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an attribute-style payload hidden in a campaign name', () => {
    // A real campaign could be named this; the sync stores whatever Google
    // returns, so it reaches the model and comes back in prose.
    //
    // The assertion is that no *element* is produced. The literal text
    // `onerror=` surviving is correct and harmless — it is inside an escaped
    // `&lt;img …&gt;`, which is a string on the page, not an attribute. An
    // earlier version of this test failed on that substring and would have
    // sent me hunting a bug that was not there.
    const html = render('Top campaign: <img src=x onerror="fetch(\'/evil\')">');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('does not let a markdown link become an anchor', () => {
    // Links are deliberately unsupported: an assistant that can render a
    // clickable destination of its own choosing is a phishing surface. The
    // scheme survives as plain text, which is the point — it is visible and
    // inert rather than clickable.
    const html = render('See [the report](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
  });
});

describe('formatting', () => {
  it('renders bold and inline code', () => {
    const html = render('Spend was **₹1.8L** via `campaignRollup`.');
    expect(html).toContain('<strong');
    expect(html).toContain('₹1.8L');
    expect(html).toContain('<code');
    expect(html).toContain('campaignRollup');
  });

  it('renders a bullet list', () => {
    const html = render('- First\n- Second');
    expect(html).toContain('<ul');
    expect((html.match(/<li/g) ?? []).length).toBe(2);
  });

  it('renders a numbered list', () => {
    const html = render('1. First\n2. Second');
    expect(html).toContain('<ol');
    expect((html.match(/<li/g) ?? []).length).toBe(2);
  });

  it('renders a table with a header row', () => {
    const html = render(
      ['| Account | Spend |', '| --- | ---: |', '| Kollege52 | ₹68,040 |'].join('\n')
    );
    expect(html).toContain('<table');
    // `/<th/` also matches `<thead`, which is how this first read as three
    // header cells for a two-column table.
    expect((html.match(/<th[ >]/g) ?? []).length).toBe(2);
    expect((html.match(/<td[ >]/g) ?? []).length).toBe(2);
    expect(html).toContain('Kollege52');
  });

  it('treats a pipe line that is not a table as a paragraph', () => {
    const html = render('The | character appears here.');
    expect(html).not.toContain('<table');
    expect(html).toContain('<p');
  });

  it('joins wrapped lines into one paragraph', () => {
    const html = render('Spend rose sharply\nin the last week.');
    expect((html.match(/<p/g) ?? []).length).toBe(1);
  });

  it('survives an empty answer without throwing', () => {
    expect(() => render('')).not.toThrow();
  });
});
