import test from 'node:test';
import assert from 'node:assert/strict';

import { highlightSchema, escapeHtmlText } from '../scripts/load-source.mjs';

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

test('an empty schema renders as empty', () => {
  assert.equal(highlightSchema(''), '');
});

test('line comments (both # and //) are marked as comments', () => {
  const html = highlightSchema('# one\n// two');
  assert.match(html, /class="tk-comment">#{1} one</);
  assert.match(html, /class="tk-comment">\/\/ two/);
});

test('an entity declaration marks keyword, name and brace', () => {
  const html = highlightSchema('entity User {');
  assert.match(html, /<span class="tk-keyword">entity<\/span> </);
  assert.match(html, /<span class="tk-name">User<\/span> </);
  assert.match(html, /<span class="tk-brace">\{<\/span>$/);
});

test('an inline empty entity marks both braces', () => {
  const html = highlightSchema('entity User {}');
  const braces = [...html.matchAll(/tk-brace/g)];
  assert.equal(braces.length, 2);
});

test('a bare entity name is colored without a brace', () => {
  const html = highlightSchema('entity User');
  assert.match(html, /<span class="tk-name">User<\/span>$/);
  assert.doesNotMatch(html, /tk-brace/);
});

test('a keyword-less entity declaration marks name and brace', () => {
  const html = highlightSchema('User {');
  assert.doesNotMatch(html, /tk-keyword/);
  assert.match(html, /<span class="tk-name">User<\/span> </);
  assert.match(html, /<span class="tk-brace">\{<\/span>$/);
});

test('a keyword-less inline empty entity marks both braces', () => {
  const html = highlightSchema('User {}');
  const braces = [...html.matchAll(/tk-brace/g)];
  assert.equal(braces.length, 2);
});

test('a type-less field inside a block is not mistaken for an entity', () => {
  const html = highlightSchema('entity User {\n  name\n}');
  assert.match(html, /<span class="tk-field">name<\/span>/);
});

test('a field with a type marks field, colon, type and cardinality', () => {
  const html = highlightSchema(
    'entity User {\n  posts: Post[1:n]\n}',
  );
  assert.match(html, /<span class="tk-field">posts<\/span>/);
  assert.match(html, /<span class="tk-punct">:<\/span>/);
  assert.match(html, /<span class="tk-type">\s*Post<\/span>/);
  assert.match(html, /<span class="tk-card">\[1:n\]<\/span>/);
});

test('an optional marker on the type is its own token', () => {
  const html = highlightSchema(
    'entity User {\n  author: User[n:1?]\n  name\n  legacy: Post[1:n]?\n}',
  );
  assert.match(html, /<span class="tk-card">\[n:1\?\]<\/span>/);
  assert.match(html, /<span class="tk-card">\[1:n\]<\/span><span class="tk-mod">\?<\/span>/);
  assert.match(html, /<span class="tk-field">legacy<\/span>/);
  assert.match(html, /<span class="tk-field">name<\/span>/);
});

test('an anonymous relation marks keyword, name and cardinality', () => {
  const html = highlightSchema(
    'entity User {\n  rel Post[1:1?]\n}',
  );
  assert.match(html, /<span class="tk-keyword">rel<\/span> </);
  assert.match(html, /<span class="tk-name">Post<\/span>/);
  assert.match(html, /<span class="tk-card">\[1:1\?\]<\/span>/);
});

test('a field named rel with a colon is not treated as a relation', () => {
  const html = highlightSchema('entity User {\n  rel: int\n}');
  assert.doesNotMatch(html, /<span class="tk-keyword">rel<\/span>/);
  assert.match(html, /<span class="tk-field">rel<\/span><span class="tk-punct">:<\/span>/);
  assert.match(html, /<span class="tk-type"> int<\/span>/);
});

test('state closes on the closing brace: lines after it are plain fields', () => {
  const html = highlightSchema(
    'entity User {\n  id: int\n}\n\norphan line',
  );
  const lines = html.split('\n');
  assert.match(lines[0], /tk-keyword/);
  assert.match(lines[2], /<span class="tk-brace">\}<\/span>$/);
  assert.match(lines[4], /<span class="tk-field">orphan<\/span> <span class="tk-type">line<\/span>/);
});

test('an opened entity keeps its state until it is closed', () => {
  const html = highlightSchema(
    'entity A {\n  rel B[1:1]\n}\nentity B {\n  id: int\n}',
  );
  assert.doesNotMatch(html, /<span class="tk-field">rel<\/span>/);
  assert.match(html, /<span class="tk-keyword">rel<\/span> <span class="tk-name">B<\/span><span class="tk-card">\[1:1\]<\/span>/);
});

test('stray braces stay braces and do not corrupt the line', () => {
  const html = highlightSchema(
    'entity User {\n  }\n  x\n}',
  );
  const lines = html.split('\n');
  assert.match(lines[1], /<span class="tk-brace">\}<\/span>$/);
  // After the closing brace we are back at top level, so the lone `x` is a
  // (keyword-less) entity name, not a field.
  assert.match(lines[2], /<span class="tk-name">x<\/span>/);
});

test('angle brackets and ampersands are escaped', () => {
  const html = highlightSchema('entity User {\n  a < b & c\n}');
  assert.match(html, /&lt; b &amp; c/);
  assert.doesNotMatch(html, / < b/);
});

test('tag-stripped output matches the source character for character', () => {
  const source = [
    '# comment',
    'entity User {',
    '  id: int',
    '  posts: Post[1:n]',
    '  rel Tag[1:1?]',
    '  email',
    '}',
  ].join('\n');
  for (const variant of [source, `${source}\n`]) {
    const text = stripTags(highlightSchema(variant));
    const expected = variant.endsWith('\n') ? `${variant} ` : variant;
    assert.equal(text, expected);
  }
});

test('unbalanced brackets fall back to plain text', () => {
  const html = highlightSchema('entity User {\n  broken: Post[1:n\n}');
  assert.match(html, /<span class="tk-type"> Post<\/span>\[1:n/);
  assert.doesNotMatch(html, /tk-card/);
});

test('oversized input degrades to escaped plain text', () => {
  const big = `entity User {\n  id: int\n}\n` + 'x\n'.repeat(400_000);
  const html = highlightSchema(big);
  assert.doesNotMatch(html, /<span/);
  assert.equal(html, escapeHtmlText(big));
});
