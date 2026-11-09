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
const MAX_WIDTH = 448;
// Keep-out band around each card used when routing edges, so a line that would
// graze a card's corner or edge is nudged clear of it rather than touching it.
const ROUTE_MARGIN = 6;
// Small perpendicular lead-in used by the orthogonal "channel" route: a short
// 90° stub plus this gap makes unmistakably clear which side of a card a
// relationship attaches to and which way it runs, instead of a slanted line
// running along/into the card edge. (Regular Bézier relations are left to touch
// the card directly; this only applies to channel routes.)
const FACE_STUB = 16;

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

// The two Bézier control points for an edge, with an optional perpendicular
// "bow". A bow of 0 is the plain S-curve; a non-zero bow pushes the belly of the
// curve sideways into the open channel to route around any cards it would
// otherwise cross.
function curveControls(
  start,
  end,
  horizontal,
  sourceSide,
  targetSide,
  bow,
) {
  const gap = horizontal
    ? Math.abs(end.x - start.x)
    : Math.abs(end.y - start.y);
  const curve = Math.max(32, Math.min(165, gap * 0.46));
  if (horizontal) {
    return {
      controlA: {
        x: start.x + (sourceSide === 'right' ? curve : -curve),
        y: start.y + bow,
      },
      controlB: {
        x: end.x + (targetSide === 'left' ? -curve : curve),
        y: end.y + bow,
      },
    };
  }
  return {
    controlA: {
      x: start.x + bow,
      y: start.y + (sourceSide === 'bottom' ? curve : -curve),
    },
    controlB: {
      x: end.x + bow,
      y: end.y + (targetSide === 'top' ? -curve : curve),
    },
  };
}

// A path sampler: given a geometry that may be a Bézier (start/controlA/
// controlB/end) or an orthogonal polyline (with a `sample` method), return a
// point for a parameter t in [0,1]. Polyline geometries carry their own
// arc-length-normalized sample(); Bézier geometries fall back to the cubic.
function pointAt(geometry, t) {
  if (geometry.sample) return geometry.sample(t);
  return cubicPoint(
    geometry.start,
    geometry.controlA,
    geometry.controlB,
    geometry.end,
    t,
  );
}

// Count how many sampled points of the edge fall inside (or within ROUTE_MARGIN
// of) any other card — everything except the two it connects. 0 means the edge is
// fully clear of every entity. Cards that do not overlap the curve's own box (or
// its margin) are skipped up front, so the test scales with nearby cards only.
// Counting (rather than a boolean) lets route resolution pick the *least*
// overlapping detour: a full row of wide cards can box the line in, so the best
// move may be to loop out to the open side rather than a tight squeeze.
// Works for both Bézier and polyline geometries via pointAt().
function measureOverlap(geometry, cards, excluded) {
  if (cards.length === 0) return 0;

  const probe = [];
  for (let i = 0; i <= 8; i += 1) probe.push(pointAt(geometry, i / 8));
  const bx0 = Math.min(...probe.map((p) => p.x));
  const bx1 = Math.max(...probe.map((p) => p.x));
  const by0 = Math.min(...probe.map((p) => p.y));
  const by1 = Math.max(...probe.map((p) => p.y));

  const near = [];
  for (const card of cards) {
    if (card.name === excluded.source || card.name === excluded.target) {
      continue;
    }
    if (
      card.x - ROUTE_MARGIN > bx1 ||
      card.x + card.width + ROUTE_MARGIN < bx0 ||
      card.y - ROUTE_MARGIN > by1 ||
      card.y + card.height + ROUTE_MARGIN < by0
    ) {
      continue;
    }
    near.push(card);
  }
  if (near.length === 0) return 0;

  let overlap = 0;
  const SAMPLES = 24;
  for (let i = 1; i < SAMPLES; i += 1) {
    const point = pointAt(geometry, i / SAMPLES);
    for (const card of near) {
      if (
        point.x > card.x - ROUTE_MARGIN &&
        point.x < card.x + card.width + ROUTE_MARGIN &&
        point.y > card.y - ROUTE_MARGIN &&
        point.y < card.y + card.height + ROUTE_MARGIN
      ) {
        overlap += 1;
        break;
      }
    }
  }
  return overlap;
}

// Total length of a polyline.
function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return length;
}

// A point sampler over a polyline, normalized to arc length (t=0.5 is the path
// midpoint). Lets label/cardinality placement treat a straight-channel path the
// same as a Bézier.
function polylineSampler(points) {
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const len = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
    segments.push({ a: points[i - 1], b: points[i], start: total, len });
    total += len;
  }
  if (total <= 0) {
    const p = points[0] || { x: 0, y: 0 };
    return () => ({ ...p });
  }
  return (t) => {
    const d = Math.max(0, Math.min(1, t)) * total;
    for (const seg of segments) {
      if (seg.len <= 0) continue;
      if (d <= seg.start + seg.len) {
        const f = (d - seg.start) / seg.len;
        return {
          x: seg.a.x + f * (seg.b.x - seg.a.x),
          y: seg.a.y + f * (seg.b.y - seg.a.y),
        };
      }
    }
    return { ...points[points.length - 1] };
  };
}

// Build an SVG path `d` for a polyline, with the internal corners rounded by
// `radius` so an orthogonal route reads as a smooth jog rather than sharp angles.
function roundedPath(points, radius) {
  if (points.length < 2) {
    const p = points[0] || { x: 0, y: 0 };
    return `M ${p.x} ${p.y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${inX} ${inY} Q ${cur.x} ${cur.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// Unit vector pointing OUTWARDS from a card face (away from the card interior).
// A line stubbed along this leaves/enters the card at 90°.
function faceNormal(side, horizontal) {
  if (side === 'top') return { x: 0, y: -1 };
  if (side === 'bottom') return { x: 0, y: 1 };
  if (side === 'left') return { x: -1, y: 0 };
  if (side === 'right') return { x: 1, y: 0 };
  return horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

// An orthogonal "channel" route for an edge that is too obstructed for a single
// Bézier, or that a Bézier would only reach at a slant. It leaves each card with a
// short 90° stub + gap, then jogs into a clear slot between the cards and across
// to the target (also a 90° stub in). Several candidate slots are tried (the gaps
// between card edges, the two open extremes, and the near-direct line) and the one
// that overlaps the fewest cards is used — with clean perpendicular ends throughout.
function channelGeometry(
  start,
  end,
  horizontal,
  sourceSide,
  targetSide,
  cards,
  excluded,
) {
  const source = { ...start };
  const target = { ...end };
  const others = cards.filter(
    (c) => c.name !== excluded.source && c.name !== excluded.target,
  );
  const axis = horizontal ? 'y' : 'x';
  const read = (p) => (axis === 'y' ? p.y : p.x);

  // Short perpendicular stubs off each card face keep the line 90° at both ends
  // even as the middle of the route detours.
  const nS = faceNormal(sourceSide, horizontal);
  const nT = faceNormal(targetSide, horizontal);
  const stub = (p, n) => ({
    x: p.x + n.x * FACE_STUB,
    y: p.y + n.y * FACE_STUB,
  });
  const s1 = stub(source, nS);
  const t1 = stub(target, nT);

  const edges = new Set();
  for (const card of others) {
    if (axis === 'y') {
      edges.add(card.y);
      edges.add(card.y + card.height);
    } else {
      edges.add(card.x);
      edges.add(card.x + card.width);
    }
  }
  edges.add(read(source));
  edges.add(read(target));

  const values = [...edges].sort((a, b) => a - b);
  const lo = values[0];
  const hi = values[values.length - 1];
  const candidates = new Set();
  candidates.add(lo - 26);
  candidates.add(hi + 26);
  for (let i = 0; i < values.length - 1; i += 1) {
    candidates.add((values[i] + values[i + 1]) / 2);
  }
  candidates.add((read(source) + read(target)) / 2);

  const build = (channelCoord) => {
    if (horizontal) {
      return [
        source,
        s1,
        { x: s1.x, y: channelCoord },
        { x: t1.x, y: channelCoord },
        t1,
        target,
      ];
    }
    return [
      source,
      s1,
      { x: channelCoord, y: s1.y },
      { x: channelCoord, y: t1.y },
      t1,
      target,
    ];
  };

  let best = null;
  for (const coord of candidates) {
    const points = build(coord);
    const sample = polylineSampler(points);
    const overlap = measureOverlap(
      { sample, start: source, end: target },
      cards,
      excluded,
    );
    const length = polylineLength(points);
    if (
      best === null ||
      overlap < best.overlap ||
      (overlap === best.overlap && length < best.length)
    ) {
      best = { points, sample, overlap, length };
    }
  }

  return {
    start: source,
    end: target,
    sample: best.sample,
    path: roundedPath(best.points, 13),
  };
}

// Route an edge so it never visually overlaps another entity. It measures how
// much a candidate curve overlaps cards and grows a perpendicular "bow" (the axis
// at right angles to the route) until the curve is clear of all of them. The
// ladder runs from a light nudge all the way out past a full row/column of cards,
// so a card sitting in the path is looped around rather than tucked behind it.
// The smallest bow that is fully clear wins; if a curve can never be fully clear
// (completely boxed in), we still apply the smallest bow that reduces the clutter,
// and only leave it straight if nothing helps.
function resolveBow(
  start,
  end,
  horizontal,
  sourceSide,
  targetSide,
  cards,
  excluded,
) {
  if (cards.length === 0) return 0;
  const probe = (bow) => {
    const { controlA, controlB } = curveControls(
      start,
      end,
      horizontal,
      sourceSide,
      targetSide,
      bow,
    );
    return measureOverlap(
      { start, controlA, controlB, end },
      cards,
      excluded,
    );
  };

  const base = probe(0);
  if (base === 0) return 0;

  // Bow magnitudes, capped. A single Bézier can loop around one card in a modest
  // arc, but it cannot route around an entire row/col of cards without launching
  // a huge loop that dwarfs the diagram — so the step ladder tops out around a
  // natural single-card loop (belly ≈ 270px). When a curve still overlaps cards
  // after the cap, those cards simply sit behind the line (cards are opaque and
  // painted over the edges layer) instead of forcing a giant detour.
  let bestZero = null;
  let bestReduction = null;
  for (const direction of [-1, 1]) {
    for (const magnitude of [18, 34, 58, 92, 134, 192, 262, 360]) {
      const bow = direction * magnitude;
      const overlap = probe(bow);
      if (overlap === 0) {
        if (bestZero === null || Math.abs(bow) < Math.abs(bestZero)) {
          bestZero = bow;
        }
      } else if (
        overlap < base &&
        (bestReduction === null ||
          overlap < bestReduction.overlap ||
          (overlap === bestReduction.overlap &&
            Math.abs(bow) < Math.abs(bestReduction.bow)))
      ) {
        bestReduction = { bow, overlap };
      }
    }
  }

  if (bestZero !== null) return bestZero;
  if (bestReduction !== null) return bestReduction.bow;
  return 0;
}

function edgeGeometry(
  relation,
  nodeMap,
  route,
  startOffset,
  endOffset,
  cards = [],
) {
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
  if (route.horizontal) {
    start = {
      x: route.sourceSide === 'right' ? source.x + source.width : source.x,
      y: sourceCenter.y + startOffset,
    };
    end = {
      x: route.targetSide === 'left' ? target.x : target.x + target.width,
      y: targetCenter.y + endOffset,
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
  }

  const excluded = { source: relation.source, target: relation.target };
  const bow = resolveBow(
    start,
    end,
    route.horizontal,
    route.sourceSide,
    route.targetSide,
    cards,
    excluded,
  );
  const { controlA, controlB } = curveControls(
    start,
    end,
    route.horizontal,
    route.sourceSide,
    route.targetSide,
    bow,
  );

  // A regular relation hugs the card: the curve starts/ends right on the card
  // face (no gap), so a crow's-foot cardinality reads as attached to the entity.
  const bezier = {
    start,
    end,
    controlA,
    controlB,
    label: cubicPoint(start, controlA, controlB, end, 0.5),
    sample: (t) => cubicPoint(start, controlA, controlB, end, t),
    path: `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`,
  };
  const bezierOverlap = measureOverlap(bezier, cards, excluded);

  // A lightly-bowed Bézier hugs the card and is kept as-is. A heavy bow, however,
  // loops far out and leaves the curve on a slant — it reads as "crossing" the
  // cards even where it technically dips behind them. For those, an orthogonal
  // channel is far cleaner: 90° in and out, routed by a clear slot, any overlap an
  // edge has there is hidden behind the cards it passes under.
  if (Math.abs(bow) > 40) {
    return channelGeometry(
      start,
      end,
      route.horizontal,
      route.sourceSide,
      route.targetSide,
      cards,
      excluded,
    );
  }
  if (bezierOverlap > 0) {
    const channel = channelGeometry(
      start,
      end,
      route.horizontal,
      route.sourceSide,
      route.targetSide,
      cards,
      excluded,
    );
    if (measureOverlap(channel, cards, excluded) < bezierOverlap) return channel;
  }

  return bezier;
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
    sample: (t) => cubicPoint(start, controlA, controlB, end, t),
  };
}
function cardBounds(node) {
  return { name: node.name, x: node.x, y: node.y, width: node.width, height: node.height };
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
    const point = pointAt(geometry, t);
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

  const SAMPLES = 64;
  const points = new Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = from === 'start' ? i / SAMPLES : 1 - i / SAMPLES;
    points[i] = pointAt(geometry, t);
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

      const inner = node.width - 30; // 16px left + 14px right padding
      const gap = typeText ? 14 : 0;
      const wantType = typeText ? textWidth(typeText, FONT_TYPE) : 0;
      const wantName = textWidth(field.name, FONT_FIELD);

      // Give each side its natural width when they fit. `measureEntities` sizes
      // the card to the widest field, so this only clips once the card is at
      // its cap: then keep the type (the informative part) and trim the name,
      // or trim the type only if it alone fills the row. This is what lets a
      // long `character varying(15)` stay whole instead of being cut to fit a
      // fixed slice of the row.
      let giveName = wantName;
      let giveType = wantType;
      if (wantName + wantType + gap > inner && wantName + wantType > 0) {
        if (wantType >= inner) {
          giveName = Math.min(wantName, inner * 0.2);
          giveType = Math.max(0, inner - giveName - gap);
        } else {
          giveName = Math.max(0, inner - wantType - gap);
        }
      }

      const displayType = typeText
        ? truncateText(typeText, FONT_TYPE, Math.max(0, giveType))
        : '';
      const displayName = truncateText(
        field.name,
        FONT_FIELD,
        Math.max(0, giveName),
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

function attachHighlighting(svg, nodeGroups, edgeGroups, labelGroups) {
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

  return setHighlight;
}

function renderDiagram(svg, layout, relations) {
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
        cardBoundsList,
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
  const highlight = attachHighlighting(svg, nodeGroups, edgeGroups, labelGroups);

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

