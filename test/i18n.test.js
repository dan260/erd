import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { I18N, parseSchema } from '../scripts/load-source.mjs';

const INDEX_HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8',
);

const PLURAL_FORMS = ['one', 'few', 'many', 'other'];

function baseKey(key) {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return key;
  const form = key.slice(dot + 1);
  return PLURAL_FORMS.includes(form) ? key.slice(0, dot) : key;
}

function hasForm(dict, base) {
  return PLURAL_FORMS.some((form) =>
    Object.prototype.hasOwnProperty.call(dict, `${base}.${form}`),
  );
}

test('dictionaries contain the same keys', () => {
  const en = I18N.MESSAGES.en;
  const ru = I18N.MESSAGES.ru;

  for (const key of Object.keys(en)) {
    const base = baseKey(key);
    if (base === key) {
      assert.equal(typeof ru[key], 'string', `ru is missing "${key}"`);
    } else {
      assert.ok(hasForm(ru, base), `ru is missing a form of "${base}"`);
    }
  }

  for (const key of Object.keys(ru)) {
    const base = baseKey(key);
    if (base === key) {
      assert.equal(typeof en[key], 'string', `en is missing "${key}"`);
    } else {
      assert.ok(hasForm(en, base), `en is missing a form of "${base}"`);
    }
  }
});

test('every entry is a non-empty string', () => {
  for (const [key, value] of Object.entries(I18N.MESSAGES.en)) {
    assert.equal(typeof value, 'string', `en:${key} must be a string`);
    assert.ok(value.trim(), `en:${key} must not be empty`);
  }
  for (const [key, value] of Object.entries(I18N.MESSAGES.ru)) {
    assert.equal(typeof value, 'string', `ru:${key} must be a string`);
    assert.ok(value.trim(), `ru:${key} must not be empty`);
  }
});

test('default language is english', () => {
  assert.equal(I18N.getLanguage(), 'en');
  assert.equal(I18N.t('status.ready'), 'Ready');
});

test('unknown languages are ignored', () => {
  I18N.setLanguage('fr');
  assert.equal(I18N.getLanguage(), 'en');
});

test('t() substitutes parameters in both languages', () => {
  I18N.setLanguage('en');
  assert.equal(
    I18N.t('diag.duplicateEntity', { name: 'User' }),
    'Entity “User” is already declared.',
  );
  I18N.setLanguage('ru');
  assert.equal(
    I18N.t('diag.duplicateEntity', { name: 'User' }),
    'Сущность «User» уже объявлена.',
  );
  I18N.setLanguage('en');
});

test('plural() picks language-specific forms', () => {
  I18N.setLanguage('en');
  assert.equal(I18N.plural(1, 'entities'), '1 entity');
  assert.equal(I18N.plural(4, 'relations'), '4 relations');
  assert.equal(I18N.plural(2, 'errors'), '2 errors');

  I18N.setLanguage('ru');
  assert.equal(I18N.plural(1, 'entities'), '1 сущность');
  assert.equal(I18N.plural(3, 'entities'), '3 сущности');
  assert.equal(I18N.plural(12, 'entities'), '12 сущностей');
  assert.equal(I18N.plural(0, 'errors'), '0 ошибок');
  assert.equal(I18N.plural(1, 'relations'), '1 связь');
  I18N.setLanguage('en');
});

test('switching language re-localizes parser diagnostics', () => {
  const source = `entity User {
  posts: Post[]
}

entity Post {
  id: int
}`;

  I18N.setLanguage('ru');
  const ru = parseSchema(source).errors[0].message;
  assert.match(ru, /Устаревший тип «Post\[\]»/);
  assert.match(ru, /Post\[1:n\]/);

  I18N.setLanguage('en');
  const en = parseSchema(source).errors[0].message;
  assert.match(en, /Legacy type “Post\[\]”/);
  assert.match(en, /Post\[1:n\]/);
});

test('render strings exist for both languages', () => {
  for (const key of [
    'render.noFields',
    'render.entityAria',
    'render.diagramAria',
    'render.anonRelation',
  ]) {
    I18N.setLanguage('en');
    assert.notEqual(I18N.t(key), key, `${key} missing in en`);
    I18N.setLanguage('ru');
    assert.notEqual(I18N.t(key), key, `${key} missing in ru`);
  }
  I18N.setLanguage('en');
});

test('keys with rich markup are bound via data-i18n-html', () => {
  const textBindings = new Set(
    [...INDEX_HTML.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
  );
  const htmlBindings = new Set(
    [...INDEX_HTML.matchAll(/data-i18n-html="([^"]+)"/g)].map((match) => match[1]),
  );

  for (const key of new Set([...textBindings, ...htmlBindings])) {
    const values = ['en', 'ru'].map((lang) => I18N.MESSAGES[lang][key]);
    const isRich = values.some((value) => /<[a-z]/i.test(value ?? ''));
    if (isRich) {
      assert.ok(
        htmlBindings.has(key),
        `"${key}" contains markup but is bound with data-i18n (textContent)`,
      );
    } else {
      assert.ok(
        textBindings.has(key),
        `"${key}" is plain text and should use data-i18n`,
      );
    }
  }
});
