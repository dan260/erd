import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const source = ['i18n.js', 'theme.js', 'parser.js', 'layout.js', 'drawio.js']
  .map((name) => readFileSync(path.join(root, 'src', name), 'utf8'))
  .join('\n');
const load = new Function(`${source}
return {
  I18N,
  parseSchema,
  parseTypeModifiers,
  layoutDiagram,
  buildDrawioFile,
};`);

const {
  I18N,
  parseSchema,
  parseTypeModifiers,
  layoutDiagram,
  buildDrawioFile,
} = load();

export {
  I18N,
  parseSchema,
  parseTypeModifiers,
  layoutDiagram,
  buildDrawioFile,
};
