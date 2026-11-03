import test from 'node:test';
import assert from 'node:assert/strict';

import { substituteCssVariables } from '../scripts/load-source.mjs';

test('substituteCssVariables replaces a known variable', () => {
  const lookup = (name) => (name === '--accent' ? '#365fd8' : '');
  assert.equal(substituteCssVariables('var(--accent)', lookup), '#365fd8');
});

test('substituteCssVariables replaces variables inside a longer value', () => {
  const lookup = (name) => (name === '--accent' ? '#365fd8' : '');
  assert.equal(
    substituteCssVariables('var(--accent) 1.5px', lookup),
    '#365fd8 1.5px',
  );
});

test('substituteCssVariables falls back when the variable is missing', () => {
  const lookup = () => '';
  assert.equal(
    substituteCssVariables('var(--missing, #111111)', lookup),
    '#111111',
  );
});

test('substituteCssVariables keeps the token when nothing resolves', () => {
  const lookup = () => '';
  assert.equal(
    substituteCssVariables('var(--missing)', lookup),
    'var(--missing)',
  );
});

test('substituteCssVariables replaces every occurrence', () => {
  const lookup = (name) => (name === '--a' ? 'red' : '');
  assert.equal(
    substituteCssVariables('var(--a) var(--a)', lookup),
    'red red',
  );
});

test('substituteCssVariables ignores values without variables', () => {
  assert.equal(substituteCssVariables('#fffdfb', () => ''), '#fffdfb');
});
