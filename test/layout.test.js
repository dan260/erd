import test from 'node:test';
import assert from 'node:assert/strict';

import { layoutDiagram } from '../scripts/load-source.mjs';

function node(name, width = 240, height = 180, order = 0) {
  return { name, width, height, order };
}

function relation(source, target) {
  return { source, target };
}

function overlapping(first, second) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

test('lays out a connected chain without overlaps', () => {
  const nodes = [
    node('User', 240, 200, 0),
    node('Post', 280, 260, 1),
    node('Comment', 230, 150, 2),
  ];
  const layout = layoutDiagram(nodes, [
    relation('User', 'Post'),
    relation('Post', 'Comment'),
  ]);

  assert.equal(layout.nodes.length, 3);
  assert.ok(layout.width > 0);
  assert.ok(layout.height > 0);

  for (let first = 0; first < layout.nodes.length; first += 1) {
    for (let second = first + 1; second < layout.nodes.length; second += 1) {
      assert.equal(
        overlapping(layout.nodes[first], layout.nodes[second]),
        false,
        `${layout.nodes[first].name} overlaps ${layout.nodes[second].name}`,
      );
    }
  }

  const positions = new Map(
    layout.nodes.map((item) => [item.name, item]),
  );
  assert.ok(positions.get('Post').x < positions.get('User').x);
  assert.ok(
    Math.abs(positions.get('User').x - positions.get('Comment').x) < 30,
  );
});

test('packs disconnected entities without overlaps', () => {
  const nodes = Array.from({ length: 8 }, (_, index) =>
    node(`Entity${index}`, 240, 200, index),
  );
  const layout = layoutDiagram(nodes, []);

  for (let first = 0; first < layout.nodes.length; first += 1) {
    for (let second = first + 1; second < layout.nodes.length; second += 1) {
      assert.equal(
        overlapping(layout.nodes[first], layout.nodes[second]),
        false,
      );
    }
  }
});

test('handles cycles, self references and reversed relation directions', () => {
  const nodes = [
    node('A', 220, 180, 0),
    node('B', 260, 220, 1),
    node('C', 240, 200, 2),
    node('Self', 220, 140, 3),
  ];
  const layout = layoutDiagram(nodes, [
    relation('A', 'B'),
    relation('B', 'C'),
    relation('C', 'A'),
    relation('Self', 'Self'),
  ]);

  assert.equal(layout.nodes.length, 4);
  for (const item of layout.nodes) {
    assert.equal(Number.isFinite(item.x), true);
    assert.equal(Number.isFinite(item.y), true);
  }
});

test('returns empty bounds for an empty schema', () => {
  assert.deepEqual(layoutDiagram([], []), {
    nodes: [],
    width: 0,
    height: 0,
  });
});
