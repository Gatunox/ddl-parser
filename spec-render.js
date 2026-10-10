'use strict';

/**
 * spec-render.js — SPEC-message-format-detector.md → the HTML the app shows
 * under Settings → Help → Specification. Build time only: build.js calls it and
 * writes the result into the page, so the app carries the specification of the
 * version it is, works offline, and needs no Markdown parser in the browser.
 *
 * Kept out of build.js so test.js can call it — build.js builds on require.
 */

const { Marked } = require('marked');

const REPO = 'https://github.com/Gatunox/ddl-parser/blob/main/';

function renderSpec(md) {
  const toc = [];
  const seen = new Map();
  const slug = s => {
    let base = 'spec-' + s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = slug(inner);
        if (depth === 2 || depth === 3) toc.push({ depth, id, inner });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        // Another file of the repository does not exist inside the app; its
        // place to be read is the repository itself.
        if (/^[^:#/]+\.md(#.*)?$/.test(href)) href = REPO + href;
        const ext = /^https?:/.test(href);
        return `<a href="${href}"${title ? ` title="${title}"` : ''}` +
               (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + `>${inner}</a>`;
      },
    },
  });

  const body = marked.parse(md);
  const items = toc.map(t => `<li class="spec-toc-${t.depth}"><a href="#${t.id}">${t.inner}</a></li>`).join('');
  const nav = `<nav class="spec-toc"><div class="spec-toc-title">Contents</div><ul>${items}</ul></nav>\n`;
  // Under the title and its introduction — the first rule ends them — so the
  // document opens on what it is, then on what is in it.
  const hr = body.indexOf('<hr>');
  return hr < 0 ? nav + body : body.slice(0, hr) + nav + body.slice(hr + '<hr>'.length);
}

module.exports = { renderSpec };
