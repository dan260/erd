'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const UI_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const FONT_TITLE = `600 14px ${UI_FONT}`;
const FONT_FIELD = `500 13px ${UI_FONT}`;
const FONT_TYPE = `500 11.5px ${MONO_FONT}`;
const FONT_LABEL = `500 11px ${UI_FONT}`;
const MIN_WIDTH = 226;
const MAX_WIDTH = 366;

let measurementContext = null;

function getMeasurementContext() {
  if (!measurementContext) {
    measurementContext = document.createElement('canvas').getContext('2d');
  }
  return measurementContext;
}

function textWidth(text, font) {
  const context = getMeasurementContext();
  context.font = font;
  return context.measureText(text).width;
}

function truncateText(text, font, maxWidth) {
  if (!text || maxWidth <= 0) return '';
  if (textWidth(text, font) <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  let result = '…';

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${text.slice(0, middle).trimEnd()}…`;
    if (textWidth(candidate, font) <= maxWidth) {
      result = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

function createElement(tag, attributes = {}, parent = null) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) {
      element.setAttribute(name, String(value));
    }
  }
  if (parent) parent.appendChild(element);
  return element;
}

function entityColor(index) {
  return ENTITY_PALETTES[index % ENTITY_PALETTES.length];
}

/**
 * Measures entity cards. HTML canvas gives us browser-accurate metrics without
 * needing to mount temporary DOM nodes.
 */
function measureEntities(entities) {
  return entities.map((entity, index) => {
    let width = Math.max(
      MIN_WIDTH,
      textWidth(entity.name, FONT_TITLE) + 58,
    );

    for (const field of entity.fields) {
      const typeText = field.type
        ? `${field.reference ? '→ ' : ''}${field.type}`
        : '';
      const nameWidth = textWidth(field.name, FONT_FIELD);
      const typeWidth = typeText ? textWidth(typeText, FONT_TYPE) : 0;
      const needed = Math.max(
        nameWidth + 34,
        nameWidth + typeWidth + 55,
      );
      width = Math.max(width, needed);
    }

    width = Math.min(MAX_WIDTH, Math.ceil(width));
    const height =
      HEADER_HEIGHT +
      (entity.fields.length > 0
        ? entity.fields.length * ROW_HEIGHT
        : EMPTY_ROW_HEIGHT);

    return {
      ...entity,
      order: index,
      width,
      height,
      headerHeight: HEADER_HEIGHT,
      rowHeight: ROW_HEIGHT,
      palette: entityColor(index),
    };
  });
}

function cubicPoint(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * controlA.x +
      3 * inverse * t ** 2 * controlB.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * controlA.y +
      3 * inverse * t ** 2 * controlB.y +
      t ** 3 * end.y,
  };
}

function relationTooltip(relation) {
  if (relation.fields.length === 0) {
    return I18N.t('render.anonRelation', {
      source: relation.source,
      target: relation.target,
    });
  }

  return relation.fields
    .map(
      (field) =>
        `${field.entity}.${field.name} → ${field.target}`,
    )
    .join('\n');
}

function routeSides(relation, nodeMap) {
  const source = nodeMap.get(relation.source);
  const target = nodeMap.get(relation.target);

  if (relation.source === relation.target) {
    return { self: true };
  }

  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  const horizontal =
    Math.abs(targetCenter.x - sourceCenter.x) >=
    Math.abs(targetCenter.y - sourceCenter.y);

  if (horizontal) {
    const sourceSide =
      targetCenter.x >= sourceCenter.x ? 'right' : 'left';
    return {
      self: false,
      horizontal: true,
      sourceSide,
      targetSide: sourceSide === 'right' ? 'left' : 'right',
      sourceSort: targetCenter.y,
      targetSort: sourceCenter.y,
      axis: 'y',
    };
  }

  const sourceSide =
    targetCenter.y >= sourceCenter.y ? 'bottom' : 'top';
  return {
    self: false,
    horizontal: false,
    sourceSide,
    targetSide: sourceSide === 'bottom' ? 'top' : 'bottom',
    sourceSort: targetCenter.x,
    targetSort: sourceCenter.x,
    axis: 'x',
  };
}

function edgeGeometry(relation, nodeMap, route, startOffset, endOffset) {
  const source = nodeMap.get(relation.source);
  const target = nodeMap.get(relation.target);

  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };

  let start;
  let end;
  let controlA;
  let controlB;

  if (route.horizontal) {
    start = {
      x: route.sourceSide === 'right' ? source.x + source.width : source.x,
      y: sourceCenter.y + startOffset,
    };
    end = {
      x: route.targetSide === 'left' ? target.x : target.x + target.width,
      y: targetCenter.y + endOffset,
    };

    const gap = Math.abs(end.x - start.x);
    const curve = Math.max(32, Math.min(165, gap * 0.46));
    controlA = {
      x: start.x + (route.sourceSide === 'right' ? curve : -curve),
      y: start.y,
    };
    controlB = {
      x: end.x + (route.targetSide === 'left' ? -curve : curve),
      y: end.y,
    };
  } else {
    start = {
      x: sourceCenter.x + startOffset,
      y: route.sourceSide === 'bottom' ? source.y + source.height : source.y,
    };
    end = {
      x: targetCenter.x + endOffset,
      y: route.targetSide === 'top' ? target.y : target.y + target.height,
    };

    const gap = Math.abs(end.y - start.y);
    const curve = Math.max(32, Math.min(165, gap * 0.46));
    controlA = {
      x: start.x,
      y: start.y + (route.sourceSide === 'bottom' ? curve : -curve),
    };
    controlB = {
      x: end.x,
      y: end.y + (route.targetSide === 'top' ? -curve : curve),
    };
  }

  const path = `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
  const label = cubicPoint(start, controlA, controlB, end, 0.5);

  return {
    path,
    start,
    end,
    controlA,
    controlB,
    label,
  };
}

function selfLoopGeometry(relation, node, index, count, side) {
  const source = node;
  const centerX = source.x + source.width / 2;
  const centerY = source.y + source.height / 2;
  const radius = 56 + index * 30;
  const spread = 54 + index * 8;
  let start;
  let end;
  let controlA;
  let controlB;
  let label;
  const labelHalfWidth = (
    textWidth(truncateText(relation.label, FONT_LABEL, 220), FONT_LABEL)
    + 16
  ) / 2;

  if (side === 'left' || side === 'right') {
    const x = side === 'right' ? source.x + source.width : source.x;
    const direction = side === 'right' ? 1 : -1;
    start = { x, y: centerY - 9 };
    end = { x, y: centerY + 9 };
    controlA = { x: x + direction * radius, y: centerY - spread };
    controlB = { x: x + direction * radius, y: centerY + spread };
    label = cubicPoint(start, controlA, controlB, end, 0.5);
    label.x = x + direction * (
      0.75 * radius + 14 + labelHalfWidth
    );
    label.y = centerY + (index - (count - 1) / 2) * 24;
  } else {
    const y = side === 'bottom' ? source.y + source.height : source.y;
    const direction = side === 'bottom' ? 1 : -1;
    start = { x: centerX - 9, y };
    end = { x: centerX + 9, y };
    controlA = { x: centerX - spread, y: y + direction * radius };
    controlB = { x: centerX + spread, y: y + direction * radius };
    label = cubicPoint(start, controlA, controlB, end, 0.5);
    label.x = centerX;
    label.y = y + direction * (
      0.75 * radius + 14 + 10.5 + (index - (count - 1) / 2) * 24
    );
  }

  return {
    path: `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`,
    start,
    end,
    controlA,
    controlB,
    label,
  };
}

function cardBounds(node) {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function rectIntersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Label overlap with a set of static rects is monotone in the label width,
// so binary search finds the widest pill centered at `point` that still keeps
// `margin` of clearance from every card.
function maxClearWidth(point, maxHalfWidth, height, cards, margin) {
  const hits = (halfWidth) => {
    const rect = {
      x: point.x - halfWidth - margin,
      y: point.y - height / 2 - margin,
      width: halfWidth * 2 + margin * 2,
      height: height + margin * 2,
    };
    for (const card of cards) {
      if (rectIntersects(rect, card)) return true;
    }
    return false;
  };

  if (!hits(maxHalfWidth)) return maxHalfWidth * 2;

  let low = 0;
  let high = maxHalfWidth;
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    if (hits(mid)) high = mid;
    else low = mid;
  }

  return low * 2;
}

// Picks where along the curve the label sits. The curve midpoint can land on
// a neighbouring card (wide star edges, same-layer edges squeezed between
// rows or columns); sampling the curve finds the spot with the most free
// space, and the label width is clamped to fit that gap.
function positionLabelAlongCurve(geometry, size, cards) {
  const SPREAD = 0.28;
  const margin = 4;

  const evaluate = (t) => {
    const point = cubicPoint(
      geometry.start,
      geometry.controlA,
      geometry.controlB,
      geometry.end,
      t,
    );
    return {
      point,
      t,
      width: maxClearWidth(point, size.width / 2, size.height, cards, margin),
    };
  };

  const better = (a, b) => {
    if (a.width !== b.width) return a.width > b.width;
    return Math.abs(a.t - 0.5) < Math.abs(b.t - 0.5);
  };

  let best = evaluate(0.5);
  if (best.width >= size.width) return best;

  for (let i = 1; i <= 20; i += 1) {
    for (const t of [0.5 - SPREAD * (i / 20), 0.5 + SPREAD * (i / 20)]) {
      const candidate = evaluate(t);
      if (better(candidate, best)) best = candidate;
    }
  }

  return best;
}

// A self loop is drawn from one side of its card, and the label rides outside
// the loop on that same side. When another card stands on that side, the
// label lands on it; trying all four sides finds where the label fits and
// moves the loop along with it.
function positionSelfLoopLabel(
  relation,
  node,
  index,
  count,
  preferredSide,
  size,
  cards,
) {
  const margin = 4;
  const order = [
    preferredSide,
    ...['right', 'left', 'bottom', 'top'].filter((s) => s !== preferredSide),
  ];

  let best = null;
  for (const side of order) {
    const geometry = selfLoopGeometry(relation, node, index, count, side);
    const width = maxClearWidth(
      geometry.label,
      size.width / 2,
      size.height,
      cards,
      margin,
    );
    if (!best || width > best.width) {
      best = { geometry, width };
    }
  }

  return best;
}

function appendCardinality(parent, geometry, from, cardinality) {
  if (!cardinality) return;

  const many = cardinality === 'many' || cardinality === 'zeroMany';
  const optional =
    cardinality === 'zeroOne' || cardinality === 'zeroMany';

  const start = geometry.start;
  const controlA = geometry.controlA;
  const controlB = geometry.controlB;
  const end = geometry.end;

  const SAMPLES = 64;
  const points = new Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = from === 'start' ? i / SAMPLES : 1 - i / SAMPLES;
    points[i] = cubicPoint(start, controlA, controlB, end, t);
  }

  const cumulative = new Array(SAMPLES + 1).fill(0);
  for (let i = 1; i <= SAMPLES; i++) {
    cumulative[i] = cumulative[i - 1] +
      Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  function frameAt(distance) {
    const d = Math.max(0, Math.min(distance, cumulative[SAMPLES]));
    let idx = SAMPLES;
    for (let i = 0; i <= SAMPLES; i++) {
      if (cumulative[i] >= d) { idx = i; break; }
    }
    const prev = Math.max(0, idx - 1);
    const segLen = cumulative[idx] - cumulative[prev];
    const t = idx > 0 && segLen > 0.001
      ? (d - cumulative[prev]) / segLen
      : 0;
    const x = points[prev].x + t * (points[idx].x - points[prev].x);
    const y = points[prev].y + t * (points[idx].y - points[prev].y);
    const dx = points[idx].x - points[prev].x;
    const dy = points[idx].y - points[prev].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x, y, tx: dx / len, ty: dy / len, px: -dy / len, py: dx / len };
  }

  if (many) {
    const apex = frameAt(8);
    const tip = frameAt(0.5);
    for (const shift of [-6, 0, 6]) {
      createElement(
        'path',
        {
          d: `M ${apex.x} ${apex.y} L ${tip.x + tip.px * shift} ${tip.y + tip.py * shift}`,
          class: 'erd-cardinality',
        },
        parent,
      );
    }
  } else {
    const bar = frameAt(7);
    createElement(
      'path',
      {
        d: `M ${bar.x + bar.px * 5.5} ${bar.y + bar.py * 5.5} L ${bar.x - bar.px * 5.5} ${bar.y - bar.py * 5.5}`,
        class: 'erd-cardinality',
      },
      parent,
    );
  }

  if (optional) {
    const circle = frameAt(many ? 17 : 15);
    createElement(
      'circle',
      {
        cx: circle.x,
        cy: circle.y,
        r: 3.4,
        class: 'erd-cardinality-circle',
      },
      parent,
    );
  }
}

function renderEntities(parent, nodes, svgName) {
  const nodeGroups = [];

  for (const node of nodes) {
    const group = createElement(
      'g',
      {
        class: 'erd-node',
        transform: `translate(${node.x} ${node.y})`,
        'data-entity': node.name,
        role: 'group',
        'aria-label': I18N.t('render.entityAria', { name: node.name }),
      },
      parent,
    );
    nodeGroups.push(group);

    createElement(
      'rect',
      {
        width: node.width,
        height: node.height,
        rx: 12,
        class: 'erd-card-shadow',
        filter: `url(#${svgName}-shadow)`,
      },
      group,
    );

    createElement(
      'rect',
      {
        width: node.width,
        height: node.height,
        rx: 12,
        class: 'erd-card',
      },
      group,
    );

    const headerPath = [
      `M 0 ${HEADER_HEIGHT}`,
      `L 0 12`,
      `Q 0 0 12 0`,
      `L ${node.width - 12} 0`,
      `Q ${node.width} 0 ${node.width} 12`,
      `L ${node.width} ${HEADER_HEIGHT}`,
      'Z',
    ].join(' ');
    createElement(
      'path',
      {
        d: headerPath,
        fill: node.palette.header,
        class: 'erd-card-header',
      },
      group,
    );

    createElement(
      'circle',
      {
        cx: 17,
        cy: HEADER_HEIGHT / 2,
        r: 3.5,
        fill: node.palette.accent,
        class: 'erd-card-accent',
      },
      group,
    );

    const title = truncateText(
      node.name,
      FONT_TITLE,
      node.width - 46,
    );
    const titleElement = createElement(
      'text',
      {
        x: 28,
        y: HEADER_HEIGHT / 2 + 1,
        class: 'erd-card-title',
      },
      group,
    );
    titleElement.textContent = title;
    if (title !== node.name) {
      createElement('title', {}, titleElement).textContent = node.name;
    }

    createElement(
      'line',
      {
        x1: 1,
        y1: HEADER_HEIGHT,
        x2: node.width - 1,
        y2: HEADER_HEIGHT,
        class: 'erd-row-divider erd-header-divider',
      },
      group,
    );

    if (node.fields.length === 0) {
      const empty = createElement(
        'text',
        {
          x: node.width / 2,
          y: HEADER_HEIGHT + EMPTY_ROW_HEIGHT / 2,
          class: 'erd-empty-text',
          'text-anchor': 'middle',
        },
        group,
      );
      empty.textContent = I18N.t('render.noFields');
    }

    node.fields.forEach((field, index) => {
      const rowCenterY =
        HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
      const row = createElement('g', { class: 'erd-field-row' }, group);
      const tooltip = field.reference
        ? `${field.name}: ${field.type} → ${field.reference}`
        : field.type
          ? `${field.name}: ${field.type}`
          : field.name;
      createElement('title', {}, row).textContent = tooltip;

      let typeText = '';
      if (field.type) {
        typeText = `${field.reference ? '→ ' : ''}${field.type}`;
      }

      const typeMaxWidth = Math.floor(node.width * 0.46);
      const displayType = typeText
        ? truncateText(typeText, FONT_TYPE, typeMaxWidth)
        : '';
      const typeWidth = displayType
        ? textWidth(displayType, FONT_TYPE)
        : 0;
      const nameMaxWidth =
        node.width - 32 - (typeWidth > 0 ? typeWidth + 14 : 0);
      const displayName = truncateText(
        field.name,
        FONT_FIELD,
        Math.max(40, nameMaxWidth),
      );

      const nameElement = createElement(
        'text',
        {
          x: 16,
          y: rowCenterY + 1,
          class: 'erd-field-name',
        },
        row,
      );
      nameElement.textContent = displayName;

      if (displayType) {
        const typeElement = createElement(
          'text',
          {
            x: node.width - 14,
            y: rowCenterY + 1,
            class: `erd-field-type${field.reference ? ' is-reference' : ''}`,
            'text-anchor': 'end',
          },
          row,
        );
        typeElement.textContent = displayType;
        if (displayType !== typeText) {
          createElement('title', {}, typeElement).textContent = typeText;
        }
      }

      if (index < node.fields.length - 1) {
        createElement(
          'line',
          {
            x1: 1,
            y1: HEADER_HEIGHT + (index + 1) * ROW_HEIGHT,
            x2: node.width - 1,
            y2: HEADER_HEIGHT + (index + 1) * ROW_HEIGHT,
            class: 'erd-row-divider',
          },
          group,
        );
      }
    });

    createElement(
      'rect',
      {
        width: node.width,
        height: node.height,
        rx: 12,
        class: 'erd-card-outline',
      },
      group,
    );
  }

  return nodeGroups;
}

function labelSize(relation) {
  const displayText = truncateText(relation.label, FONT_LABEL, 220);
  return {
    displayText,
    width: textWidth(displayText, FONT_LABEL) + 16,
    height: 21,
  };
}

// Pill widths per relation, keyed by relation id. The layout uses these to
// stretch the gap between same-layer neighbours that share a relation, so the
// label gets room instead of being squeezed down.
function measureLabelWidths(relations) {
  const widths = new Map();
  for (const relation of relations) {
    if (!relation.label) continue;
    widths.set(relation.id, labelSize(relation).width);
  }
  return widths;
}

function renderLabel(parent, relation, point, width) {
  const displayText = truncateText(
    relation.label,
    FONT_LABEL,
    Math.max(24, width - 16),
  );
  const height = 21;
  const group = createElement(
    'g',
    {
      class: 'erd-label',
      'data-source': relation.source,
      'data-target': relation.target,
      'data-relation': relation.id,
      transform: `translate(${point.x - width / 2} ${point.y - height / 2})`,
    },
    parent,
  );
  createElement('title', {}, group).textContent = relationTooltip(relation);
  createElement(
    'rect',
    {
      width,
      height,
      rx: 6.5,
      class: 'erd-label-background',
    },
    group,
  );
  const text = createElement(
    'text',
    {
      x: width / 2,
      y: height / 2 + 0.5,
      class: 'erd-label-text',
      'text-anchor': 'middle',
    },
    group,
  );
  text.textContent = displayText;

  return group;
}

function attachHighlighting(
  svg,
  nodeGroups,
  edgeGroups,
  labelGroups,
  onNodeHover,
) {
  const setHighlight = (name) => {
    const hasFocus =
      Boolean(name) &&
      nodeGroups.some((group) => group.dataset.entity === name);
    svg.classList.toggle('has-node-focus', hasFocus);

    for (const group of nodeGroups) {
      group.classList.toggle(
        'is-dimmed',
        hasFocus && group.dataset.entity !== name,
      );
    }

    for (const group of [...edgeGroups, ...labelGroups]) {
      const related =
        group.dataset.source === name || group.dataset.target === name;
      group.classList.toggle('is-active', hasFocus && related);
      group.classList.toggle('is-dimmed', hasFocus && !related);
    }
  };

  for (const group of nodeGroups) {
    const name = group.dataset.entity;
    group.addEventListener('pointerenter', () => {
      setHighlight(name);
      onNodeHover?.(name);
    });
    group.addEventListener('pointerleave', () => {
      setHighlight(null);
      onNodeHover?.(null);
    });
  }

  return setHighlight;
}

function renderDiagram(svg, layout, relations, onNodeHover) {
  svg.replaceChildren();
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    I18N.t('render.diagramAria', {
      n: layout.nodes.length,
      m: relations.length,
    }),
  );

  const padding = 64;
  const svgName = `erd-${Math.random().toString(36).slice(2, 8)}`;
  const defs = createElement('defs', {}, svg);
  const filter = createElement(
    'filter',
    {
      id: `${svgName}-shadow`,
      x: '-25%',
      y: '-25%',
      width: '150%',
      height: '160%',
    },
    defs,
  );
  createElement(
    'feDropShadow',
    {
      dx: 0,
      dy: 3,
      stdDeviation: 4.5,
      'flood-color': '#1d2433',
      'flood-opacity': '0.09',
    },
    filter,
  );

  const root = createElement('g', {}, svg);
  const edgeLayer = createElement(
    'g',
    { class: 'erd-edge-layer' },
    root,
  );
  const nodeLayer = createElement(
    'g',
    { class: 'erd-node-layer' },
    root,
  );
  const labelLayer = createElement(
    'g',
    { class: 'erd-label-layer' },
    root,
  );

  const nodeMap = new Map(layout.nodes.map((node) => [node.name, node]));
  const cardBoundsList = layout.nodes.map(cardBounds);
  const routes = relations.map((relation) =>
    routeSides(relation, nodeMap),
  );
  const anchorGroups = new Map();
  const sideUsage = new Map();

  routes.forEach((route, relationIndex) => {
    if (route.self) return;
    const relation = relations[relationIndex];
    const endpoints = [
      {
        node: nodeMap.get(relation.source),
        side: route.sourceSide,
        type: 'start',
        sort: route.sourceSort,
      },
      {
        node: nodeMap.get(relation.target),
        side: route.targetSide,
        type: 'end',
        sort: route.targetSort,
      },
    ];

    for (const endpoint of endpoints) {
      const key = `${endpoint.node.name}|${endpoint.side}`;
      if (!anchorGroups.has(key)) {
        anchorGroups.set(key, {
          node: endpoint.node,
          side: endpoint.side,
          axis: route.axis,
          items: [],
        });
      }
      anchorGroups.get(key).items.push({
        relationIndex,
        type: endpoint.type,
        sort: endpoint.sort,
      });

      if (!sideUsage.has(endpoint.node.name)) {
        sideUsage.set(endpoint.node.name, {
          right: 0,
          left: 0,
          bottom: 0,
          top: 0,
        });
      }
      sideUsage.get(endpoint.node.name)[endpoint.side] += 1;
    }
  });

  const startOffsets = new Array(relations.length).fill(0);
  const endOffsets = new Array(relations.length).fill(0);

  for (const group of anchorGroups.values()) {
    group.items.sort(
      (a, b) => a.sort - b.sort || a.relationIndex - b.relationIndex,
    );
    const length =
      group.axis === 'y' ? group.node.height : group.node.width;
    const available = Math.max(0, length - 36);
    const maxOffset = available / 2;
    const step =
      group.items.length > 1
        ? Math.min(14, (maxOffset * 2) / (group.items.length - 1))
        : 0;

    group.items.forEach((item, index) => {
      const offset =
        (index - (group.items.length - 1) / 2) * step;
      if (item.type === 'start') {
        startOffsets[item.relationIndex] = offset;
      } else {
        endOffsets[item.relationIndex] = offset;
      }
    });
  }

  const sidePriority = { right: 0, left: 1, bottom: 2, top: 3 };
  const selfSides = new Map();
  const selfCounts = new Map();

  for (const relation of relations) {
    if (relation.source !== relation.target) continue;
    selfCounts.set(
      relation.source,
      (selfCounts.get(relation.source) || 0) + 1,
    );
  }

  for (const name of selfCounts.keys()) {
    const usage = sideUsage.get(name) || {
      right: 0,
      left: 0,
      bottom: 0,
      top: 0,
    };
    const side = Object.keys(sidePriority).sort(
      (a, b) =>
        usage[a] - usage[b] || sidePriority[a] - sidePriority[b],
    )[0];
    selfSides.set(name, side);
  }

  const selfIndexes = new Map();
  const edgeGroups = [];
  const labelGroups = [];

  for (let relationIndex = 0; relationIndex < relations.length; relationIndex += 1) {
    const relation = relations[relationIndex];
    const source = nodeMap.get(relation.source);
    const target = nodeMap.get(relation.target);
    if (!source || !target) continue;

    let selfIndex = 0;
    if (relation.source === relation.target) {
      selfIndex = selfIndexes.get(relation.source) || 0;
      selfIndexes.set(relation.source, selfIndex + 1);
    }

    let geometry;
    let selfPlacement = null;
    if (routes[relationIndex].self) {
      const preferred = selfSides.get(relation.source) || 'right';
      if (relation.label) {
        const found = positionSelfLoopLabel(
          relation,
          source,
          selfIndex,
          selfCounts.get(relation.source) || 1,
          preferred,
          labelSize(relation),
          cardBoundsList,
        );
        geometry = found.geometry;
        selfPlacement = { point: found.geometry.label, width: found.width };
      } else {
        geometry = selfLoopGeometry(
          relation,
          source,
          selfIndex,
          selfCounts.get(relation.source) || 1,
          preferred,
        );
      }
    } else {
      geometry = edgeGeometry(
        relation,
        nodeMap,
        routes[relationIndex],
        startOffsets[relationIndex],
        endOffsets[relationIndex],
      );
    }
    const edgeGroup = createElement(
      'g',
      {
        class: 'erd-edge',
        'data-source': relation.source,
        'data-target': relation.target,
        'data-relation': relation.id,
      },
      edgeLayer,
    );
    createElement('title', {}, edgeGroup).textContent =
      relationTooltip(relation);

    const pathAttrs = {
      d: geometry.path,
      class: 'erd-edge-line',
      stroke: EDGE_COLOR,
    };
    if (typeof ERDRAFT_SETTINGS !== 'undefined' && ERDRAFT_SETTINGS.edgeStyle === 'dashed') {
      pathAttrs['stroke-dasharray'] = '8 5';
    }
    createElement('path', pathAttrs, edgeGroup);

    appendCardinality(
      edgeGroup,
      geometry,
      'start',
      relation.sourceCard,
    );
    appendCardinality(
      edgeGroup,
      geometry,
      'end',
      relation.targetCard,
    );
    edgeGroups.push(edgeGroup);

    if (relation.label) {
      let point;
      let width;
      if (routes[relationIndex].self && selfPlacement) {
        point = selfPlacement.point;
        width = selfPlacement.width;
      } else {
        const spot = positionLabelAlongCurve(
          geometry,
          labelSize(relation),
          cardBoundsList,
        );
        point = spot.point;
        width = spot.width;
      }
      labelGroups.push(renderLabel(labelLayer, relation, point, width));
    }
  }

  const nodeGroups = renderEntities(nodeLayer, layout.nodes, svgName);
  const highlight = attachHighlighting(
    svg,
    nodeGroups,
    edgeGroups,
    labelGroups,
    onNodeHover,
  );

  const contentBox = root.getBBox();
  const viewWidth = Math.max(
    1,
    Math.ceil(contentBox.width + padding * 2),
  );
  const viewHeight = Math.max(
    1,
    Math.ceil(contentBox.height + padding * 2),
  );
  root.setAttribute(
    'transform',
    `translate(${padding - contentBox.x} ${padding - contentBox.y})`,
  );
  svg.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);

  return {
    width: viewWidth,
    height: viewHeight,
    padding,
    highlight,
  };
}

