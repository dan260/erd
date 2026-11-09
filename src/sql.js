'use strict';

// A tolerant compiler from SQL DDL to ERDraft. It reads `CREATE TABLE`
// statements, maps tables to entities and columns to fields, and turns foreign
// keys (column- or table-level) into relations. The result is plain ERDraft
// text, so an import flows through the very same parser, layout and render
// pipeline as anything typed by hand: import, edit, export.
//
// The dialect is deliberately loose — the usual DDL of Postgres, MySQL and
// SQLite parses — and unsupported statements are skipped rather than reported,
// so a real-world dump degrades gracefully instead of aborting.

function skipSpaces(text, index) {
  let i = index;
  const n = text.length;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9 || code === 10 || code === 13) {
      i += 1;
    } else if (text[i] === '-' && i + 1 < n && text[i + 1] === '-') {
      i += 2;
      while (i < n && text.charCodeAt(i) !== 10) i += 1;
    } else if (text[i] === '/' && i + 1 < n && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && i + 1 < n && text[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
    } else {
      break;
    }
  }
  return i;
}

// Words that open a table or column constraint. A column's storage type ends
// at the first of these; everything before it is the type. Because the multi
// words of types such as `TIMESTAMP WITH TIME ZONE` or `DOUBLE PRECISION` are
// none of these, the loop simply keeps reading them as part of the type.
const CONSTRAINT_START = new Set([
  'NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'DEFAULT', 'REFERENCES', 'CHECK',
  'CONSTRAINT', 'FOREIGN', 'KEY', 'GENERATED', 'COLLATE', 'AUTO_INCREMENT',
  'AUTOINCREMENT', 'INCREMENT', 'IDENTITY',
]);

// Returns the index just past the `)` matching the `(` at `index`, or -1.
function findMatchingParen(text, index) {
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Reads one token of a definition: a bare word, a string literal, one of
// `)`/`,`/`;`, or — for an opening paren — the whole balanced `(...)` group.
// Consuming the group as a single unit keeps the keywords and commas *inside*
// a `DEFAULT f(a, b)` or a `CHECK (x IN (1, 2))` from confusing the scanner.
function matchToken(text, index) {
  const i = skipSpaces(text, index);
  if (i >= text.length) return null;
  const ch = text[i];
  if (ch === '(') {
    const close = findMatchingParen(text, i);
    const end = close === -1 ? text.length : close + 1;
    return { text: text.slice(i, end), end, index: i, group: true };
  }
  if (ch === ')' || ch === ',' || ch === ';') {
    return { text: ch, end: i + 1, index: i, group: false };
  }
  let j = i;
  // A quote introduces a string literal, read as a single token.
  if (ch === '\'' || ch === '"') {
    j += 1;
    while (j < text.length) {
      if (text[j] === ch) {
        if (j + 1 < text.length && text[j + 1] === ch) {
          j += 2;
        } else {
          j += 1;
          break;
        }
      } else {
        j += 1;
      }
    }
    return { text: text.slice(i, j), end: j, index: i, group: false };
  }
  // Otherwise a run of identifier-like characters.
  while (
    j < text.length &&
    !' \t\n\r'.includes(text[j]) &&
    !"',;()".includes(text[j])
  ) {
    j += 1;
  }
  if (j === i) return null;
  let word = text.slice(i, j);
  const first = word[0];
  const last = word[word.length - 1];
  if (word.length > 1 && ((first === '[' && last === ']') || (first === '`' && last === '`'))) {
    word = word.slice(1, -1).replace(/``/g, '`');
  }
  return { text: word, end: j, index: i, group: false };
}

// Reads the storage type that follows a column name: the consecutive tokens up
// to the first constraint keyword. Multi-word types (`TIMESTAMP WITH TIME
// ZONE`, `DOUBLE PRECISION`) and parameters (`VARCHAR(255)`) are included
// because their words and paren groups are none of those keywords.
function readType(text, index) {
  let i = skipSpaces(text, index);
  const start = i;
  let end = start;

  for (;;) {
    i = skipSpaces(text, i);
    const token = matchToken(text, i);
    if (!token) break;
    if (CONSTRAINT_START.has(token.text.toUpperCase())) break;
    i = token.end;
    end = i;
  }

  const cleaned = text
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .replace(/ +\(/g, '(')
    .trim();
  return { text: cleaned, end };
}

// Consumes an expression (a default value, a check, a generated column …) by
// stepping over tokens until the next constraint keyword. Paren groups and
// string literals are consumed as single units, so the keywords and commas
// inside them never confuse the scanner. Returns the index at the stop word.
function skipExpression(text, index) {
  let i = index;
  const n = text.length;
  for (;;) {
    i = skipSpaces(text, i);
    if (i >= n) return i;
    const token = matchToken(text, i);
    if (!token) return i;
    if (CONSTRAINT_START.has(token.text.toUpperCase())) return i;
    i = token.end;
  }
}

function readIdentifier(text, index) {
  const n = text.length;
  let i = skipSpaces(text, index);
  if (i >= n) return null;
  if (text[i] === '"') {
    i += 1;
    for (; i < n && text[i] !== '"'; i += 1) {
      if (text[i] === '"' && i + 1 < n && text[i + 1] === '"') i += 1;
    }
    i += 1;
  } else if (text[i] === '`') {
    i += 1;
    for (; i < n && text[i] !== '`'; i += 1) {
      if (text[i] === '`' && i + 1 < n && text[i + 1] === '`') i += 1;
    }
    i += 1;
  } else if (text[i] === '[') {
    i = text.indexOf(']', i);
    i = i === -1 ? n : i + 1;
  } else {
    for (; i < n && !' \t\n\r,(){};'.includes(text[i]); i += 1) {}
  }
  if (i >= n) return null;

  let name;
  let end = i;
  if (text[i] === '.') {
    for (;;) {
      const next = matchToken(text, i + 1);
      if (!next) break;
      name = next.text;
      end = next.end;
      if (text[end] !== '.') break;
      end += 1;
    }
  } else {
    name = text.slice(index, i);
  }

  if (name) {
    const first = name[0];
    const last = name[name.length - 1];
    if (name.length > 1 && ((first === '[' && last === ']') || (first === '`' && last === '`'))) {
      name = name.slice(1, -1).replace(/``/g, '`');
    } else if (name.length > 1 && first === '"' && last === '"') {
      name = name.slice(1, -1).replace(/""/g, '"');
    }
  }

  return name ? { name, end } : null;
}

// Splits a definition list at top-level commas, i.e. commas that are not inside
// a parenthesized expression (so `DECIMAL(10,2)` and `CHECK (a IN (1,2))` stay whole).
function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

// ERDraft identifiers are `[\p{L}_][\p{L}\p{N}_]*`. A name that would not be a
// valid identifier (dashes, spaces, a leading digit) is mangled to one, so a
// table or column named `my-table` still imports — as `my_table`.
function toSafeIdent(name) {
  let out = '';
  for (const ch of String(name ?? '')) {
    out += /[\p{L}\p{N}_]/u.test(ch) ? ch : '_';
  }
  if (!out) out = '_';
  if (/^[0-9]/u.test(out)) out = `_${out}`;
  return out;
}

function parseReferenceTail(text, index, column) {
  let i = skipSpaces(text, index);
  const table = readIdentifier(text, i);
  if (!table) return { index, table: null, columns: null };

  i = skipSpaces(text, table.end);
  let columns = [column.name];
  const token = matchToken(text, i);
  if (token && token.group) {
    // `REFERENCES table (col, …)` — an explicit list of referenced columns.
    columns = splitTopLevel(text.slice(token.index + 1, token.end - 1)).map((part) => part.trim());
    i = token.end;
  }

  if (matchToken(text, i)?.text.toUpperCase() === 'ON') {
    i = skipOnClause(text, i);
  }

  return { index: i, table: table.name, columns };
}

// Steps over a pair of `ON DELETE <action>` / `ON UPDATE <action>` clauses.
function skipOnClause(text, index) {
  let i = skipSpaces(text, index);
  for (;;) {
    const on = matchToken(text, i);
    if (!on || on.text.toUpperCase() !== 'ON') break;
    const action = matchToken(text, skipSpaces(text, on.end));
    if (!action) break;
    let j = action.end;
    // `SET NULL` / `SET DEFAULT` add one trailing word.
    const extra = matchToken(text, skipSpaces(text, j));
    if (action.text.toUpperCase() === 'SET' && extra && /^(NULL|DEFAULT)$/i.test(extra.text)) {
      j = extra.end;
    }
    i = j;
    if (matchToken(text, skipSpaces(text, j))?.text.toUpperCase() !== 'ON') break;
  }
  return i;
}

// Parses the constraint part of a column definition (everything after the
// type) and folds the foreign key out of it so the caller owns it.
function parseColumnConstraints(column, text, foreignKeys) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    i = skipSpaces(text, i);
    if (i >= n) break;
    const token = matchToken(text, i);
    if (!token) break;
    const upper = token.text.toUpperCase();
    i = token.end;

    if (upper === 'PRIMARY') {
      const next = matchToken(text, skipSpaces(text, i));
      if (next && next.text.toUpperCase() === 'KEY') {
        column.primaryKey = true;
        i = next.end;
      } else break;
    } else if (upper === 'NOT') {
      const next = matchToken(text, skipSpaces(text, i));
      if (next && next.text.toUpperCase() === 'NULL') {
        column.notNull = true;
        i = next.end;
      } else break;
    } else if (upper === 'NULL') {
      column.notNull = false;
    } else if (upper === 'UNIQUE') {
      column.unique = true;
    } else if (upper === 'REFERENCES') {
      const tail = parseReferenceTail(text, i, column);
      if (tail.table) {
        foreignKeys.push({
          columns: [column.name],
          table: tail.table,
          columnsTarget: tail.columns,
        });
      }
      i = tail.index;
    } else if (
      upper === 'DEFAULT' ||
      upper === 'CHECK' ||
      upper === 'GENERATED' ||
      upper === 'COLLATE' ||
      upper === 'IDENTITY' ||
      upper === 'AS'
    ) {
      i = skipExpression(text, i);
    } else {
      break;
    }
  }
}

function parseColumnDefinition(def) {
  const id = readIdentifier(def, 0);
  if (!id) return null;

  const column = {
    name: id.name,
    safeName: toSafeIdent(id.name),
    rawType: '',
    primaryKey: false,
    unique: false,
    notNull: false,
    refs: [],
  };

  const afterName = def.slice(id.end);
  const trimmed = afterName.replace(/^[\s(]/, '');
  const gap = afterName.length - trimmed.length;
  let index = id.end + gap;

  // A column may carry constraints without a type (e.g. `id PRIMARY KEY`);
  // then the first token is a constraint keyword and there is no type at all.
  if (trimmed.length > 0 && !CONSTRAINT_START.has(matchToken(trimmed, 0)?.text.toUpperCase())) {
    const type = readType(def, index);
    if (type.text) column.rawType = type.text;
    index = type.end;
  }

  const foreignKeys = [];
  parseColumnConstraints(column, def.slice(index), foreignKeys);
  column.foreignKeys = foreignKeys;
  return column;
}

function parseTableConstraint(text, table) {
  let i = 0;
  let sawKind = null;

  const first = matchToken(text, i);
  if (!first) return;

  if (first.text.toUpperCase() === 'CONSTRAINT') {
    i = first.end;
    const id = readIdentifier(text, skipSpaces(text, i));
    if (id) i = skipSpaces(text, id.end);
  }

  const kind = matchToken(text, i);
  if (!kind) return;
  sawKind = kind.text.toUpperCase();
  i = skipSpaces(text, kind.end);

  // `PRIMARY KEY` / `FOREIGN KEY` are two words.
  if (sawKind === 'PRIMARY' || sawKind === 'FOREIGN') {
    const key = matchToken(text, i);
    if (key && key.text.toUpperCase() === 'KEY') {
      i = skipSpaces(text, key.end);
    }
  }

  if (text[i] !== '(') return;
  const close = findMatchingParen(text, i);
  if (close === -1) return;

  const list = splitTopLevel(text.slice(i + 1, close)).map((part) => part.trim());
  i = close + 1;

  if (sawKind === 'PRIMARY') {
    for (const col of list) table.primaryKeys.add(col);
  } else if (sawKind === 'UNIQUE') {
    table.uniques.push(list);
  } else if (sawKind === 'FOREIGN') {
    let j = skipSpaces(text, i);
    const refs = matchToken(text, j);
    if (refs && refs.text.toUpperCase() === 'REFERENCES') {
      j = skipSpaces(text, refs.end);
      const tableRef = readIdentifier(text, j);
      if (!tableRef) return;
      j = skipSpaces(text, tableRef.end);
      let columnsTarget = list;
      const paren = matchToken(text, j);
      if (paren && paren.group) {
        columnsTarget = splitTopLevel(text.slice(paren.index + 1, paren.end - 1)).map(
          (part) => part.trim(),
        );
        j = paren.end;
      }
      if (matchToken(text, j)?.text.toUpperCase() === 'ON') {
        j = skipOnClause(text, j);
      }
      table.foreignKeys.push({
        columns: list,
        table: tableRef.name,
        columnsTarget,
      });
    }
  }
}

function createTable(name, body) {
  const columns = [];
  const primaryKeys = new Set();
  const uniques = [];
  const foreignKeys = [];

  for (const def of splitTopLevel(body, ',')) {
    const head = matchToken(def, 0);
    if (!head) continue;
    const headUpper = head.text.toUpperCase();
    // An optional leading `CONSTRAINT <name>` makes the *next* word the kind.
    let inspect = def;
    if (headUpper === 'CONSTRAINT') {
      const id = readIdentifier(def, head.end);
      if (id) inspect = def.slice(id.end);
    }
    const kind = matchToken(inspect, 0);
    const kindUpper = kind ? kind.text.toUpperCase() : '';

    if (
      kindUpper === 'PRIMARY' ||
      kindUpper === 'UNIQUE' ||
      kindUpper === 'FOREIGN' ||
      kindUpper === 'CHECK' ||
      kindUpper === 'EXCLUDE' ||
      kindUpper === 'LIKE' ||
      headUpper === 'PRIMARY' ||
      headUpper === 'UNIQUE' ||
      headUpper === 'FOREIGN' ||
      headUpper === 'CHECK'
    ) {
      parseTableConstraint(def, { primaryKeys, uniques, foreignKeys });
      continue;
    }

    const column = parseColumnDefinition(def);
    if (!column) continue;
    if (column.primaryKey) primaryKeys.add(column.name);
    if (column.unique) uniques.push([column.name]);
    foreignKeys.push(...column.foreignKeys);
    columns.push(column);
  }

  return {
    name,
    safeName: toSafeIdent(name),
    columns,
    primaryKeys,
    uniques,
    foreignKeys,
  };
}

// Dumps frequently define keys and foreign keys out-of-band, e.g.
// `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY (…) REFERENCES …`, so these are
// recognised in addition to `CREATE TABLE`. The three kinds below are the only
// ones a foreign key or a key can be; anything else an `ADD` introduces is
// skipped.
const KEY_KINDS = new Set(['PRIMARY', 'UNIQUE', 'FOREIGN']);

// Returns the index just past the `;` that ends the statement at `start` (or
// the end of input if there is none). Paren depth is tracked so the commas a
// `UNIQUE (a, b)` or a `FOREIGN KEY (a)` list carries are never mistaken for a
// statement separator.
function findStatementEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = depth > 0 ? depth - 1 : 0;
    else if (ch === ';' && depth === 0) return i + 1;
  }
  return text.length;
}

// Applies the actions of one `ALTER TABLE <t> …` statement to `table`. Only
// `ADD` of a key (primary / unique / foreign) is applied, reusing the same
// `parseTableConstraint` that `CREATE TABLE` uses, so in-table and out-of-band
// declarations end up identical.
function applyAlterBody(body, table) {
  for (const action of splitTopLevel(body, ',')) {
    let i = skipSpaces(action, 0);
    const head = matchToken(action, i);
    if (!head || head.text.toUpperCase() !== 'ADD') continue;
    i = skipSpaces(action, head.end);
    const maybeColumn = matchToken(action, i);
    if (maybeColumn && maybeColumn.text.toUpperCase() === 'COLUMN') {
      i = skipSpaces(action, maybeColumn.end);
    }

    // The action is now either `CONSTRAINT <name> <kind> (…)` or `<kind> (…)`
    // or a bare column (`<name> <type> …`, which we do not adopt); only a key
    // kind is applied.
    const first = matchToken(action, i);
    if (!first) continue;

    let kindStart = i;
    if (first.text.toUpperCase() === 'CONSTRAINT') {
      let k = skipSpaces(action, first.end);
      const id = readIdentifier(action, k);
      if (id) k = skipSpaces(action, id.end);
      const kind = matchToken(action, k);
      if (!kind) continue;
      if (!KEY_KINDS.has(kind.text.toUpperCase())) continue;
      kindStart = k;
    } else if (!KEY_KINDS.has(first.text.toUpperCase())) {
      continue; // `ADD CHECK (…)`, `ADD INDEX`, a new column, …
    }

    parseTableConstraint(action.slice(kindStart), table);
  }
}

const CREATE_RE =
  /\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\s+/gi;
const ALTER_RE = /\bALTER\s+TABLE\s+(?:ONLY\s+)?/gi;

// Scans the whole input for `CREATE TABLE` blocks and `ALTER TABLE … ADD`
// constraints. Both contribute to a single table object per name, so the order
// they appear in the file does not matter: foreign keys and keys declared
// before, after, or inside the `CREATE` all land on the same entity.
function parseSql(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const tables = [];
  const byName = new Map();

  const tableFor = (rawName) => {
    const key = toSafeIdent(rawName).toLowerCase();
    const existing = byName.get(key);
    if (existing) return existing;
    const table = {
      name: rawName,
      safeName: toSafeIdent(rawName),
      columns: [],
      primaryKeys: new Set(),
      uniques: [],
      foreignKeys: [],
    };
    byName.set(key, table);
    tables.push(table);
    return table;
  };

  for (const match of text.matchAll(CREATE_RE)) {
    let i = skipSpaces(text, match.index + match[0].length);
    if (/^IF\s+NOT\s+EXISTS\s+/i.test(text.slice(i, i + 60))) {
      i = skipSpaces(
        text,
        i + text.slice(i, i + 60).match(/^IF\s+NOT\s+EXISTS\s+/i)[0].length,
      );
    }
    i = skipSpaces(text, i);

    const name = readIdentifier(text, i);
    if (!name) continue;
    i = skipSpaces(text, name.end);

    if (text[i] !== '(') continue; // CREATE TABLE … AS SELECT and friends
    const close = findMatchingParen(text, i);
    if (close === -1) continue;

    const created = createTable(name.name, text.slice(i + 1, close));
    const target = tableFor(created.name);
    // The `CREATE` is the authoritative column list; merge its keys and
    // foreign keys onto whatever an earlier `ALTER` already recorded.
    target.columns = created.columns;
    target.primaryKeys = created.primaryKeys;
    target.uniques = created.uniques;
    target.foreignKeys.push(...created.foreignKeys);
  }

  for (const match of text.matchAll(ALTER_RE)) {
    let i = skipSpaces(text, match.index + match[0].length);
    const name = readIdentifier(text, i);
    if (!name) continue;
    i = skipSpaces(text, name.end);
    const body = text.slice(i, findStatementEnd(text, i));
    applyAlterBody(body, tableFor(name.name));
  }

  return { tables };
}

// A set of column names that forms a key (a primary key or a unique constraint)
// inside `table`. Order is irrelevant, so both sides are compared canonically.
function isUniqueKey(table, rawColumns) {
  if (!table) return false;
  const columns = rawColumns.map((name) => name.split('.')[0]).sort();
  if (
    columns.length === table.primaryKeys.size &&
    columns.every((name) => table.primaryKeys.has(name))
  ) {
    return true;
  }
  const key = columns.join('\u0000');
  return table.uniques.some(
    (list) => list.length === columns.length && [...list].map((name) => name.split('.')[0]).sort().join('\u0000') === key,
  );
}

// Derives the `[owner:target]` cardinality for a foreign key. `table` is the
// declaring table, `refTable` the referenced one (possibly identical for self
// references). The referenced end is “one” when its column is a key, “many”
// otherwise; the referencing end is “one” when the referencing side is a key.
// A nullable referencing side makes the referenced end allow zero.
function cardinalityFor(table, refTable, referencing, referenced) {
  let owner = 'n';
  if (referencing.length > 0) owner = isUniqueKey(table, referencing) ? '1' : 'n';

  let target = isUniqueKey(refTable, referenced) ? '1' : 'n';

  const known = referencing
    .map((name) => table.columns.find((col) => col.name === name.split('.')[0]))
    .filter(Boolean);
  if (known.length > 0 && known.some((col) => !col.notNull)) {
    target = target === '1' ? '1?' : 'n?';
  }

  return `${owner}:${target}`;
}

function resolveNameIndex(tables) {
  const byName = new Map();
  for (const table of tables) {
    const key = table.safeName.toLowerCase();
    if (!byName.has(key)) byName.set(key, table);
  }
  return byName;
}

function tableText(table) {
  const lines = [`entity ${table.safeName} {`];

  for (const column of table.columns) {
    const name = column.safeName;
    if (column.refs.length > 0) {
      lines.push(`  ${name}: ${column.refs[0].type}`);
    } else if (column.rawType) {
      lines.push(`  ${name}: ${column.rawType}`);
    } else {
      lines.push(`  ${name}`);
    }
  }

  const seen = new Set();
  for (const relation of table.relations) {
    if (seen.has(relation)) continue;
    seen.add(relation);
    lines.push(`  rel ${relation}`);
  }

  lines.push('}');
  return lines.join('\n');
}

// The public entry point: SQL text in, ERDraft text out.
function sqlToErdraft(source) {
  const { tables } = parseSql(source);
  if (tables.length === 0) return '';

  const byName = resolveNameIndex(tables);

  const emitted = [];
  const seen = new Set();
  for (const table of tables) {
    if (seen.has(table.safeName)) continue;
    seen.add(table.safeName);
    emitted.push(table);
  }

  // A second pass resolves relations: the referenced table may be declared
  // after the referencing one, so nothing can be decided before all tables are
  // known. A single-column key becomes a reference *field* where the column
  // lives; composite keys (and keys on columns without a definition) become an
  // anonymous `rel` line. References to a table that was not in the input are
  // dropped — a relation to an absent entity would dangle off the diagram.
  for (const table of emitted) {
    table.relations = [];
    if (table.columns.length === 0) continue;

    for (const foreignKey of table.foreignKeys) {
      const target = byName.get(foreignKey.table.toLowerCase());
      if (!target) continue;

      const card = cardinalityFor(
        table,
        target,
        foreignKey.columns,
        foreignKey.columnsTarget,
      );
      const relText = `${target.safeName}[${card}]`;
      const referencing = foreignKey.columns;
      const single = referencedSingleColumn(table, referencing);

      if (single && !hasRef(table, single.name)) {
        single.refs.push({ type: relText });
      } else if (referencing.length > 1) {
        table.relations.push(relText);
      }
    }
  }

  // A table that only surfaced through an `ALTER` has no columns; if it also
  // acquired no relation it would draw as an empty card, so it is left out.
  const printable = emitted.filter(
    (table) => table.columns.length > 0 || table.relations.length > 0,
  );
  if (printable.length === 0) return '';

  return `# Imported from SQL (edit freely)\n\n${printable.map((table) => tableText(table)).join('\n\n')}\n`;
}

function referencedSingleColumn(table, referencing) {
  if (referencing.length !== 1) return null;
  return table.columns.find((col) => col.name === referencing[0].split('.')[0]) || null;
}

function hasRef(table, name) {
  const column = table.columns.find((col) => col.name === name);
  return Boolean(column && column.refs.length > 0);
}
