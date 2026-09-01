import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';

function renderer() {
  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || 'image');
  return markdown;
}

test('Markdown headings, tables, and code blocks render', () => {
  const html = renderer().render('## Review\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst ok = true;\n```');
  assert.match(html, /<h2>Review<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /<pre><code class="language-js">/);
});

test('raw HTML, unsafe links, and remote Markdown images are not activated', () => {
  const html = renderer().render('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![tracking](https://example.com/pixel.png)');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /tracking/);
});
