import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDrawioFile } from '../scripts/load-source.mjs';

const entities = [
  {
    name: 'User',
    fields: [
      { name: 'id', type: 'int', reference: null },
      { name: 'posts', type: 'Post[]', reference: 'Post' },
    ],
  },
  {
    name: 'Post',
    fields: [
      { name: 'id', type: 'int' },
      { name: 'author', type: 'User', reference: 'User' },
    ],
  },
];

const layout = {
  nodes: [
    { name: 'User', x: 0, y: 0, width: 240, height: 120 },
    { name: 'Post', x: 380, y: 40, width: 260, height: 140 },
  ],
  width: 640,
  height: 180,
};

const relations = [
  {
    id: 'rel-1',
    source: 'User',
    target: 'Post',
    sourceCard: 'one',
    targetCard: 'many',
    label: 'posts / author',
    fields: [
      { entity: 'User', name: 'posts', type: 'Post[]', target: 'Post' },
      { entity: 'Post', name: 'author', type: 'User', target: 'User' },
    ],
  },
  {
    id: 'rel-2',
    source: 'Post',
    target: 'Post',
    sourceCard: 'many',
    targetCard: 'zeroOne',
    label: 'parent',
    fields: [
      { entity: 'Post', name: 'parent', type: 'Post?', target: 'Post' },
    ],
  },
];

test('exports a valid uncompressed draw.io document', () => {
  const xml = buildDrawioFile(layout, entities, relations);

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<mxfile[^>]+agent="ERDraft"/);
  assert.match(xml, /<diagram id="erdraft-diagram"/);
  assert.match(xml, /<mxGraphModel/);
  assert.match(xml, /id="entity-0" value="User"/);
  assert.match(xml, /id="entity-1" value="Post"/);
  assert.match(xml, /id="field-0-0" value="id: int"/);
  assert.match(xml, /id="field-0-1" value="posts: Post\[\]"/);
  assert.match(xml, /startArrow=ERone/);
  assert.match(xml, /endArrow=ERmany/);
  assert.match(xml, /startArrow=ERmany/);
  assert.match(xml, /endArrow=ERzeroToOne/);
  assert.match(xml, /value="posts \/ author"/);
  assert.match(xml, /source="entity-0" target="entity-1"/);
  assert.match(xml, /source="entity-1" target="entity-1"/);
});

test('exports an anonymous relation as a label-less edge', () => {
  const xml = buildDrawioFile(layout, entities, [
    {
      id: 'rel-9',
      source: 'User',
      target: 'Post',
      sourceCard: 'one',
      targetCard: 'many',
      label: '',
      fields: [],
    },
  ]);

  assert.match(xml, /value=""[^>]*source="entity-0" target="entity-1"/);
  assert.match(xml, /startArrow=ERone/);
  assert.match(xml, /endArrow=ERmany/);
});

test('escapes values placed into the XML document', () => {
  const xml = buildDrawioFile(
    layout,
    entities,
    [
      {
        ...relations[0],
        label: 'A & B < C "quoted"',
      },
    ],
  );

  assert.match(xml, /value="A &amp; B &lt; C &quot;quoted&quot;"/);
  assert.doesNotMatch(xml, /value="A & B/);
});
