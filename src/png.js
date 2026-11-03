'use strict';

function substituteCssVariables(value, lookup) {
  return value.replace(
    /var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^()]+))?\s*\)/g,
    (token, name, fallback) => {
      const resolved = lookup(name);
      if (resolved) return resolved;
      const fallbackValue = fallback ? fallback.trim() : '';
      return fallbackValue ? fallbackValue : token;
    },
  );
}

// Mirror of the .erd-* rules from styles.css, used when the document's
// stylesheet rules cannot be read (for example when the app is opened
// directly from a file:// URL). Theme-dependent values stay as var()
// references and are resolved against the root element.
const FALLBACK_DIAGRAM_STYLES = [
  '.erd-node.is-dimmed { opacity: 0.34; }',
  '.erd-card-shadow { fill: #fff; }',
  '.erd-card { fill: #fffdfb; }',
  '.erd-card-outline { fill: none; stroke: #d9d5cc; stroke-width: 1; }',
  '.erd-card-title { fill: #1b2230; font-family: var(--font-ui); font-size: 14px; font-weight: 600; letter-spacing: -0.012em; dominant-baseline: middle; }',
  '.erd-field-name { fill: #353b46; font-family: var(--font-ui); font-size: 13px; font-weight: 500; dominant-baseline: middle; }',
  '.erd-field-type { fill: #8a8f99; font-family: var(--font-mono); font-size: 11.5px; font-weight: 500; dominant-baseline: middle; }',
  '.erd-field-type.is-reference { fill: var(--accent); font-weight: 550; }',
  '.erd-row-divider { stroke: #efede7; stroke-width: 1; }',
  '.erd-header-divider { stroke: #d9d5cc; }',
  '.erd-empty-text { fill: #a3a199; font-family: var(--font-ui); font-size: 11.5px; font-style: italic; dominant-baseline: middle; }',
  '.erd-edge-line { fill: none; stroke-width: 1.5; stroke-linecap: round; }',
  '.erd-cardinality { fill: none; stroke: #6b7486; stroke-width: 1.35; stroke-linecap: round; }',
  '.erd-cardinality-circle { fill: var(--canvas); stroke: #6b7486; stroke-width: 1.3; }',
  '.erd-edge.is-dimmed, .erd-label.is-dimmed { opacity: 0.12; }',
  '.erd-edge.is-active .erd-edge-line { stroke: var(--accent); stroke-width: 2.05; }',
  '.erd-edge.is-active .erd-cardinality, .erd-edge.is-active .erd-cardinality-circle { stroke: var(--accent); }',
  '.erd-label-background { fill: var(--label-bg); stroke: var(--label-line); stroke-width: 1; }',
  '.erd-label-text { fill: var(--label-fg); font-family: var(--font-ui); font-size: 11px; font-weight: 500; dominant-baseline: middle; }',
  '.erd-label.is-active .erd-label-background { stroke: var(--label-active-line); }',
  '.erd-label.is-active .erd-label-text { fill: var(--accent-strong); }',
].join('\n');

function collectDiagramStyles() {
  const rootStyle = getComputedStyle(document.documentElement);
  const rules = [];
  let sawSheet = false;

  for (const sheet of document.styleSheets) {
    let sheetRules;
    try {
      sheetRules = sheet.cssRules;
    } catch {
      continue;
    }

    for (const rule of sheetRules) {
      if (!rule.selectorText || !rule.style) continue;
      const matches = rule.selectorText
        .split(',')
        .some((part) => /\.erd-/.test(part));
      if (!matches) continue;

      const declarations = [];
      for (const name of rule.style) {
        if (
          name === 'vector-effect' ||
          name === 'pointer-events' ||
          name.startsWith('transition')
        ) {
          continue;
        }
        const value = rule.style.getPropertyValue(name);
        if (!value) continue;
        declarations.push(
          `${name}: ${substituteCssVariables(
            value,
            (variable) => rootStyle.getPropertyValue(variable).trim(),
          )}`,
        );
      }
      if (declarations.length > 0) {
        rules.push(`${rule.selectorText} { ${declarations.join('; ')}; }`);
        sawSheet = true;
      }
    }
  }

  if (!sawSheet) {
    return substituteCssVariables(
      FALLBACK_DIAGRAM_STYLES,
      (variable) => rootStyle.getPropertyValue(variable).trim(),
    );
  }

  return rules.join('\n');
}

function prepareDiagramSnapshot(svg, width, height) {
  const clone = svg.cloneNode(true);
  const snapshotWidth = Math.max(1, Math.round(width));
  const snapshotHeight = Math.max(1, Math.round(height));

  clone.classList.remove('has-node-focus');
  for (const node of clone.querySelectorAll('.is-active, .is-dimmed')) {
    node.classList.remove('is-active', 'is-dimmed');
  }

  clone.setAttribute('viewBox', `0 0 ${snapshotWidth} ${snapshotHeight}`);
  clone.setAttribute('width', String(snapshotWidth));
  clone.setAttribute('height', String(snapshotHeight));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = collectDiagramStyles();
  const defs = clone.querySelector('defs');
  if (defs) defs.prepend(style);
  else clone.prepend(style);

  return clone;
}

function loadSvgImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not render the SVG image'));
    };
    image.src = url;
  });
}

function exportDiagramPng(svg, width, height) {
  const imageWidth = Math.max(1, Math.round(width));
  const imageHeight = Math.max(1, Math.round(height));
  const markup = new XMLSerializer().serializeToString(
    prepareDiagramSnapshot(svg, imageWidth, imageHeight),
  );
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });

  return loadSvgImage(svgBlob).then((image) => {
    const maxArea = 24 * 1024 * 1024;
    let scale = 2;
    if (imageWidth * imageHeight * scale * scale > maxArea) {
      scale = Math.max(1, Math.sqrt(maxArea / (imageWidth * imageHeight)));
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imageWidth * scale));
    canvas.height = Math.max(1, Math.round(imageHeight * scale));
    const context = canvas.getContext('2d');

    const background = getComputedStyle(document.documentElement)
      .getPropertyValue('--canvas')
      .trim();
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode the PNG image'));
      }, 'image/png');
    });
  });
}
