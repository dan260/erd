import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const source = ['i18n.js', 'theme.js', 'parser.js', 'sql.js', 'layout.js', 'drawio.js', 'highlight.js', 'png.js']
  .map((name) => readFileSync(path.join(root, 'src', name), 'utf8'))
  .join('\n');
const load = new Function(`${source}
return {
  I18N,
  parseSchema,
  parseTypeModifiers,
  sqlToErdraft,
  layoutDiagram,
  buildDrawioFile,
  highlightSchema,
  escapeHtmlText,
  substituteCssVariables,
};`);

const {
  I18N,
  parseSchema,
  parseTypeModifiers,
  sqlToErdraft,
  layoutDiagram,
  buildDrawioFile,
  highlightSchema,
  escapeHtmlText,
  substituteCssVariables,
} = load();

export {
  I18N,
  parseSchema,
  parseTypeModifiers,
  sqlToErdraft,
  layoutDiagram,
  buildDrawioFile,
  highlightSchema,
  escapeHtmlText,
  substituteCssVariables,
};
