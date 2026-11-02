'use strict';

const HIGHLIGHT_LIMIT = 100_000;

function escapeHtmlText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function token(className, text) {
  return `<span class="tk-${className}">${escapeHtmlText(text)}</span>`;
}

function appendGap(html, text) {
  return text ? html + escapeHtmlText(text) : html;
}

function renderType(raw) {
  let html = '';
  let index = 0;
  const base = [];

  while (index < raw.length && raw[index] !== '[' && raw[index] !== '?') {
    base.push(raw[index]);
    index += 1;
  }

  const baseText = base.join('');
  if (baseText.trim()) html += token('type', baseText);
  else if (baseText) html += escapeHtmlText(baseText);

  while (index < raw.length) {
    const char = raw[index];

    if (char === '[') {
      const close = raw.indexOf(']', index);
      if (close === -1) {
        html += escapeHtmlText(raw.slice(index));
        index = raw.length;
      } else {
        html += token('card', raw.slice(index, close + 1));
        index = close + 1;
      }
    } else if (char === '?') {
      html += token('mod', '?');
      index += 1;
    } else if (char === ' ' || char === '\t') {
      let end = index;
      while (end < raw.length && (raw[end] === ' ' || raw[end] === '\t')) {
        end += 1;
      }
      html += escapeHtmlText(raw.slice(index, end));
      index = end;
    } else {
      html += escapeHtmlText(raw.slice(index));
      index = raw.length;
    }
  }

  return html;
}

function renderEntityLine(rest) {
  const body = rest.slice('entity'.length);
  const nameMatch = body.match(/^(\s*)([^\s{}]*)/u);
  const gap = nameMatch ? nameMatch[1] : '';
  const name = nameMatch ? nameMatch[2] : '';
  const tail = body.slice(gap.length + name.length);

  let html = token('keyword', 'entity') + escapeHtmlText(gap);
  if (name) html += token('name', name);

  let index = 0;
  while (index < tail.length) {
    const char = tail[index];

    if (char === '{' || char === '}') {
      html += token('brace', char);
      index += 1;
    } else {
      let end = index;
      while (
        end < tail.length &&
        tail[end] !== '{' &&
        tail[end] !== '}'
      ) {
        end += 1;
      }
      html += escapeHtmlText(tail.slice(index, end));
      index = end;
    }
  }

  const declared = Boolean(name);
  const inlined = tail.includes('{') && tail.includes('}');
  const next = declared && !inlined;

  return { html, state: next };
}

function renderRelationLine(rest, state) {
  const body = rest.slice('rel'.length);
  const match = body.match(/^(\s*)([\p{L}\p{N}_]+)([\s\S]*)$/u);

  if (!match) {
    return { html: token('keyword', 'rel') + escapeHtmlText(body), state };
  }

  const html =
    token('keyword', 'rel') +
    escapeHtmlText(match[1]) +
    token('name', match[2]) +
    renderType(match[3]);

  return { html, state };
}

function renderFieldLine(rest, state) {
  const colon = rest.indexOf(':');

  if (colon !== -1) {
    const before = rest.slice(0, colon);
    const trimmed = before.replace(/\s*$/u, '');

    let html = token('field', trimmed);
    if (trimmed.length < before.length) {
      html += escapeHtmlText(before.slice(trimmed.length));
    }
    html += token('punct', ':') + renderType(rest.slice(colon + 1));

    return { html, state };
  }

  const first = rest.match(/^(\S+)/u)?.[0] ?? '';
  if (!first) {
    return { html: escapeHtmlText(rest), state };
  }

  let name = first;
  let optional = '';
  if (first.endsWith('?') && !first.slice(0, -1).endsWith('?')) {
    name = first.slice(0, -1);
    optional = '?';
  }

  let html = token('field', name);
  if (optional) html += token('mod', optional);

  const tail = rest.slice(first.length);
  if (tail) {
    const gap = tail.match(/^\s*/u)[0];
    html += escapeHtmlText(gap) + renderType(tail.slice(gap.length));
  }

  return { html, state };
}

function highlightLine(raw, state) {
  const lead = raw.match(/^\s*/u)[0];
  let html = appendGap('', lead);
  const rest = raw.slice(lead.length);

  if (!rest) {
    return { html, state };
  }

  if (rest.startsWith('#') || rest.startsWith('//')) {
    return { html: html + token('comment', rest), state };
  }

  if (rest === '}') {
    return { html: html + token('brace', '}'), state: false };
  }

  if (rest.startsWith('}')) {
    return {
      html: html + token('brace', '}') + escapeHtmlText(rest.slice(1)),
      state,
    };
  }

  if (rest.startsWith('{')) {
    return {
      html: html + token('brace', '{') + escapeHtmlText(rest.slice(1)),
      state,
    };
  }

  if (/^entity(?=[\s]|$)/u.test(rest)) {
    const rendered = renderEntityLine(rest);
    return { html: html + rendered.html, state: rendered.state };
  }

  if (/^rel(?=[\s]|$)/u.test(rest)) {
    const rendered = renderRelationLine(rest, state);
    return { html: html + rendered.html, state: rendered.state };
  }

  const rendered = renderFieldLine(rest, state);
  return { html: html + rendered.html, state: rendered.state };
}

function highlightSchema(text) {
  const value = String(text ?? '');
  if (value.length > HIGHLIGHT_LIMIT) return escapeHtmlText(value);

  let inside = false;
  const parts = value.split('\n').map((line) => {
    const rendered = highlightLine(line, inside);
    inside = rendered.state;
    return rendered.html;
  });

  let html = parts.join('\n');
  if (value.endsWith('\n')) html += ' ';
  return html;
}
