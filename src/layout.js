'use strict';

const LAYER_GAP = 112;
const NODE_GAP = 42;
const COMPONENT_GAP_X = 150;
const COMPONENT_GAP_Y = 132;
const MAX_ROW_WIDTH = 1900;
const LABEL_GAP_MARGIN = 16;

function pairKey(first, second) {
  return [first, second].sort().join('\u0000');
}

// Neighbours on the same layer (row or column) may share a relation whose
// line sits in the gap between them. When that label is wider than the
// default gap, the gap stretches so the label fits without shrinking.
function pairSpacing(first, second, pairWidths) {
  if (!pairWidths || !second) return NODE_GAP;
  const width = pairWidths.get(pairKey(first, second));
  return width ? Math.max(NODE_GAP, width + LABEL_GAP_MARGIN) : NODE_GAP;
}

function buildAdjacency(nodes, relations) {
  const adjacency = new Map(nodes.map((node) => [node.name, new Set()]));

  for (const relation of relations) {
    if (relation.source === relation.target) continue;
    if (!adjacency.has(relation.source) || !adjacency.has(relation.target)) {
      continue;
    }
    adjacency.get(relation.source).add(relation.target);
    adjacency.get(relation.target).add(relation.source);
  }

  return adjacency;
}

function collectComponents(nodes, adjacency) {
  const visited = new Set();
  const components = [];

  for (const node of nodes) {
    if (visited.has(node.name)) continue;

    const component = [];
    const queue = [node.name];
    visited.add(node.name);

    while (queue.length > 0) {
      const name = queue.shift();
      const current = nodes.find((item) => item.name === name);
      if (current) component.push(current);

      const neighbours = [...adjacency.get(name)].filter(
        (neighbour) => !visited.has(neighbour),
      );
      neighbours.sort((a, b) => {
        const first = nodes.findIndex((item) => item.name === a);
        const second = nodes.findIndex((item) => item.name === b);
        return first - second;
      });

      for (const neighbour of neighbours) {
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }

    components.push(component);
  }

  return components;
}

function chooseRoot(component, adjacency) {
  return [...component].sort((a, b) => {
    const degreeDifference =
      adjacency.get(b.name).size - adjacency.get(a.name).size;
    if (degreeDifference !== 0) return degreeDifference;
    return a.order - b.order;
  })[0];
}

function buildLayers(component, adjacency) {
  const root = chooseRoot(component, adjacency);
  const visited = new Set([root.name]);
  const layers = [[root]];

  while (true) {
    const next = [];
    const currentLayer = layers[layers.length - 1];

    for (const node of currentLayer) {
      const neighbours = [...adjacency.get(node.name)]
        .filter((name) => !visited.has(name))
        .sort((a, b) => {
          const first = component.findIndex((item) => item.name === a);
          const second = component.findIndex((item) => item.name === b);
          return first - second;
        });

      for (const neighbour of neighbours) {
        visited.add(neighbour);
        next.push(component.find((item) => item.name === neighbour));
      }
    }

    if (next.length === 0) break;
    layers.push(next);
  }

  for (const node of component) {
    if (visited.has(node.name)) continue;
    layers.push([node]);
  }

  return layers;
}

function orderLayers(layers, adjacency) {
  const positions = new Map();
  const refreshPositions = () => {
    layers.forEach((layer) => {
      layer.forEach((node, index) => positions.set(node.name, index));
    });
  };

  refreshPositions();

  const sortByNeighbour = (layer, neighbourLayer) => {
    const neighbourPositions = new Map(
      neighbourLayer.map((node, index) => [node.name, index]),
    );

    layer.sort((a, b) => {
      const neighboursA = [...adjacency.get(a.name)].filter((name) =>
        neighbourPositions.has(name),
      );
      const neighboursB = [...adjacency.get(b.name)].filter((name) =>
        neighbourPositions.has(name),
      );

      const average = (neighbours) => {
        if (neighbours.length === 0) return null;
        return (
          neighbours.reduce(
            (sum, name) => sum + neighbourPositions.get(name),
            0,
          ) / neighbours.length
        );
      };

      const first = average(neighboursA);
      const second = average(neighboursB);

      if (first === null && second === null) {
        return positions.get(a.name) - positions.get(b.name);
      }
      if (first === null) return 1;
      if (second === null) return -1;
      if (first !== second) return first - second;
      return positions.get(a.name) - positions.get(b.name);
    });
  };

  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (let index = 1; index < layers.length; index += 1) {
      sortByNeighbour(layers[index], layers[index - 1]);
      refreshPositions();
    }

    for (let index = layers.length - 2; index >= 0; index -= 1) {
      sortByNeighbour(layers[index], layers[index + 1]);
      refreshPositions();
    }
  }
}

function stackExtent(layer, size, pairWidths) {
  let sum = 0;
  layer.forEach((node, index) => {
    sum += node[size];
    if (index + 1 < layer.length) {
      sum += pairSpacing(node.name, layer[index + 1].name, pairWidths);
    }
  });
  return sum;
}

function layoutComponent(component, adjacency, orientation, pairWidths) {
  if (component.length === 1) {
    const [node] = component;
    return {
      positions: new Map([[node.name, { x: 0, y: 0 }]]),
      width: node.width,
      height: node.height,
      firstOrder: node.order,
    };
  }

  const layers = buildLayers(component, adjacency);
  orderLayers(layers, adjacency);
  const positions = new Map();
  const vertical = orientation === 'vertical';

  if (vertical) {
    const rowHeights = layers.map((layer) =>
      Math.max(...layer.map((node) => node.height)),
    );
    const rowWidths = layers.map((layer) =>
      stackExtent(layer, 'width', pairWidths),
    );
    const blockWidth = Math.max(...rowWidths);

    let cursorY = 0;
    layers.forEach((layer, layerIndex) => {
      const rowHeight = rowHeights[layerIndex];
      const offsetX = (blockWidth - rowWidths[layerIndex]) / 2;
      let cursorX = offsetX;

      layer.forEach((node, index) => {
        positions.set(node.name, {
          x: cursorX,
          y: cursorY + (rowHeight - node.height) / 2,
        });
        cursorX +=
          node.width +
          pairSpacing(
            node.name,
            index + 1 < layer.length ? layer[index + 1].name : null,
            pairWidths,
          );
      });
      cursorY += rowHeight + LAYER_GAP;
    });
  } else {
    const layerWidths = layers.map((layer) =>
      Math.max(...layer.map((node) => node.width)),
    );
    const layerHeights = layers.map((layer) =>
      stackExtent(layer, 'height', pairWidths),
    );
    const blockHeight = Math.max(...layerHeights);

    let cursorX = 0;
    layers.forEach((layer, layerIndex) => {
      const columnWidth = layerWidths[layerIndex];
      let cursorY = -layerHeights[layerIndex] / 2;

      layer.forEach((node, index) => {
        positions.set(node.name, {
          x: cursorX + (columnWidth - node.width) / 2,
          y: cursorY,
        });
        cursorY +=
          node.height +
          pairSpacing(
            node.name,
            index + 1 < layer.length ? layer[index + 1].name : null,
            pairWidths,
          );
      });
      cursorX += columnWidth + LAYER_GAP;
    });

    for (const position of positions.values()) {
      position.y += blockHeight / 2;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of component) {
    const position = positions.get(node.name);
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + node.width);
    maxY = Math.max(maxY, position.y + node.height);
  }

  for (const position of positions.values()) {
    position.x -= minX;
    position.y -= minY;
  }

  return {
    positions,
    width: maxX - minX,
    height: maxY - minY,
    firstOrder: Math.min(...component.map((node) => node.order)),
  };
}

/**
 * Deterministic layered layout. BFS levels become columns (horizontal) or
 * rows (vertical). The barycenter sweeps reduce crossings. Disconnected groups
 * are packed side by side.
 */
function layoutDiagram(nodes, relations, options) {
  if (nodes.length === 0) {
    return { nodes: [], width: 0, height: 0 };
  }

  const orientation = (options && options.layout) || 'horizontal';
  const vertical = orientation === 'vertical';

  const adjacency = buildAdjacency(nodes, relations);

  const pairWidths = new Map();
  if (options && options.labelWidths) {
    for (const relation of relations) {
      const width = options.labelWidths.get(relation.id);
      if (!width || relation.source === relation.target) continue;
      const key = pairKey(relation.source, relation.target);
      pairWidths.set(key, Math.max(pairWidths.get(key) || 0, width));
    }
  }

  const components = collectComponents(nodes, adjacency);
  const laidOut = components.map((component) =>
    layoutComponent(component, adjacency, orientation, pairWidths),
  );

  laidOut.sort((a, b) => a.firstOrder - b.firstOrder);
  const finalPositions = new Map();

  if (vertical) {
    let cursorY = 0;
    for (const component of laidOut) {
      for (const [name, position] of component.positions) {
        finalPositions.set(name, {
          x: position.x,
          y: position.y + cursorY,
        });
      }
      cursorY += component.height + COMPONENT_GAP_Y;
    }
  } else {
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    for (const component of laidOut) {
      if (
        cursorX > 0 &&
        cursorX + component.width > MAX_ROW_WIDTH
      ) {
        cursorX = 0;
        cursorY += rowHeight + COMPONENT_GAP_Y;
        rowHeight = 0;
      }
      for (const [name, position] of component.positions) {
        finalPositions.set(name, {
          x: position.x + cursorX,
          y: position.y + cursorY,
        });
      }
      cursorX += component.width + COMPONENT_GAP_X;
      rowHeight = Math.max(rowHeight, component.height);
    }
  }

  const positioned = nodes.map((node) => {
    const position = finalPositions.get(node.name);
    return {
      ...node,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
    };
  });

  const width = Math.max(
    ...positioned.map((node) => node.x + node.width),
  );
  const height = Math.max(
    ...positioned.map((node) => node.y + node.height),
  );

  return { nodes: positioned, width, height };
}
