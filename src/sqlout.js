'use strict';

// A compiler from a parsed ERDraft schema (the output of parseSchema) to SQL DDL.
// It is the mirror of sql.js: sql.js turns `CREATE TABLE` statements into ERDraft,
// and this turns ERDraft back into `CREATE TABLE` statements, so an imported schema
// can be exported again.
//
// The interesting part is reconstructing what ERDraft only implies. ERDraft has no
// explicit NOT NULL / UNIQUE / PRIMARY KEY per column — it is all carried by the
// relation cardinality. So each DDL attribute is *derived* from the cards:
//   a reference field f on A pointing at B, with cards [source : target], becomes
//   a foreign key column whose
//     NOT NULL  follows the *referenced* end  — target one/many → NOT NULL, zero*/open → NULL
//     UNIQUE    follows the *declaring* end  — source one/zeroOne → UNIQUE (a 1:1)
//     PRIMARY KEY is granted to a mandatory 1:1 (source one AND target one), or to an `id`
//   A *to-many* reference (target many/zeroMany) is a back-reference: it draws an edge
//   in the diagram but produces no column — the foreign key lives on the other side.
//   Many-to-many relations have no column at all, so a join table is emitted.
//
// Nothing here touches the DOM: it consumes the parse result and returns plain data
// (a model) plus rendered SQL text, which keeps it testable in Node.

// ERDraft shorthand types → canonical SQL. The map is idempotent: every value it
// returns maps back to itself, so re-importing and re-exporting is byte-stable.
// Anything not listed is passed through unchanged (already-SQL types such as
// `character varying(15)` or a custom `money` round-trip exactly as written).
const SQL_TYPES = {
  int: 'INTEGER',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  smallint: 'SMALLINT',
  serial: 'SERIAL',
  'small serial': 'SMALLSERIAL',
  'big serial': 'BIGSERIAL',
  float: 'DOUBLE PRECISION',
  double: 'DOUBLE PRECISION',
  'double precision': 'DOUBLE PRECISION',
  real: 'REAL',
  decimal: 'DECIMAL',
  numeric: 'NUMERIC',
  number: 'NUMBER',
  bool: 'BOOLEAN',
  boolean: 'BOOLEAN',
  varchar: 'VARCHAR',
  'character varying': 'VARCHAR',
  char: 'CHAR',
  character: 'CHAR',
  string: 'TEXT',
  text: 'TEXT',
  bytea: 'BYTEA',
  uuid: 'UUID',
  date: 'DATE',
  datetime: 'TIMESTAMP',
  timestamp: 'TIMESTAMP',
  timestamptz: 'TIMESTAMPTZ',
  time: 'TIME',
  timetz: 'TIMETZ',
  json: 'JSON',
  jsonb: 'JSONB',
  xml: 'XML',
  interval: 'INTERVAL',
  money: 'MONEY',
  inet: 'INET',
  cidr: 'CIDR',
  macaddr: 'MACADDR',
};

// Maps an ERDraft type to a SQL type. The part before the first `(` is matched
// (case-insensitively) against SQL_TYPES; a known name is canonicalised and its
// parameters are re-attached (`varchar(255)` → `VARCHAR(255)`). Unknown types are
// returned untouched so real DDL types survive a round-trip.
function sqlType(input) {
  if (input === null || input === undefined) return 'TEXT';
  const type = String(input).trim();
  if (!type) return 'TEXT';
  const open = type.indexOf('(');
  const name = (open === -1 ? type : type.slice(0, open)).trim();
  const params = open === -1 ? '' : type.slice(open);
  const mapped = SQL_TYPES[name.toLowerCase()];
  return mapped === undefined ? type : mapped + params;
}

// Cardinality families. The four parsed cards, or null for an open (unmarked) end.
const SINGULAR = new Set(['one', 'zeroOne']);
const PLURAL = new Set(['many', 'zeroMany']);

function isSingular(card) {
  return SINGULAR.has(card);
}

function isPlural(card) {
  return PLURAL.has(card);
}

// A non-null (card === null means "the end is open, no information").
function isNonZero(card) {
  return card === 'one' || card === 'many';
}

// A reference field is one whose type names an entity (the parser records that on
// `field.reference`). Its effective cards: explicit ones if declared, otherwise the
// implicit many:one a bare `author: User` carries.
function refCards(field) {
  if (!field.reference) return null;
  return field.typeInfo && field.typeInfo.cardinality
    ? field.typeInfo.cardinality
    : { source: 'many', target: 'one' };
}

// True when the reference points at a single row (target one/zeroOne) — only such
// references become foreign key columns. A to-many reference is a back-reference.
function isToOneRef(field) {
  const cards = refCards(field);
  if (!cards) return false;
  return cards.target === 'one' || cards.target === 'zeroOne';
}

// Renders an identifier, quoting it only when it would not be a bare SQL word.
function quote(name) {
  const value = String(name);
  return /^[a-z_][a-z0-9_]*$/i.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

// The column a foreign key points at: the referenced table's primary key column,
// falling back to an `id` column, or null when the referenced table defines no key
// (an FK to a non-unique column would be invalid DDL, so the reference is skipped).
function resolveRefColumn(table, tablesByName) {
  if (!table) return null;
  if (table.pk.length) return table.pk[0];
  const id = table.columns.find((col) => col.name.toLowerCase() === 'id');
  return id ? id.name : null;
}

// The type a foreign key column should use: the type of the column it references,
// so `author_id` matches `users.id`. Recurses through 1:1 chains (a key that is
// itself a foreign key) and bails to INTEGER on a cycle.
function resolveRefType(tableName, tablesByName, seen = new Set()) {
  const table = tablesByName.get(tableName);
  if (!table) return 'INTEGER';
  const column = resolveRefColumn(table, tablesByName);
  if (!column) return 'INTEGER';
  const ref = table.columns.find((col) => col.name === column);
  if (!ref) return 'INTEGER';
  if (ref.ref) {
    if (seen.has(tableName)) return 'INTEGER';
    return resolveRefType(ref.ref.table, tablesByName, new Set([...seen, tableName]));
  }
  return ref.type || 'INTEGER';
}

// Builds the column list of one entity: every field except to-many back-references
// (which emit no column). Each foreign key column is annotated with the reference
// it backs so modelToSql can render the REFERENCES clause.
function buildTable(entity, index) {
  const columns = [];

  for (const field of entity.fields) {
    const cards = refCards(field);

    if (cards) {
      if (!isToOneRef(field)) continue; // to-many back-reference — no column
      columns.push({
        name: field.name,
        type: 'INTEGER', // overwritten once the referenced column's type is known
        pk: false,
        unique: isSingular(cards.source),
        // The referenced end not allowing zero is what makes the link mandatory.
        notNull: isNonZero(cards.target),
        ref: { table: field.reference, column: null },
        cards: { source: cards.source, target: cards.target },
      });
    } else {
      const base = field.typeInfo ? field.typeInfo.baseType : field.type;
      columns.push({
        name: field.name,
        type: sqlType(base),
        pk: false,
        unique: false,
        notNull: false,
        ref: null,
        cards: null,
      });
    }
  }

  return { name: entity.name, order: index, pk: [], columns, synthetic: false };
}

// Every table gets exactly one primary key, chosen conservatively: an `id` column
// if there is one, otherwise a mandatory 1:1 foreign key (the classic
// `profiles.user_id`), otherwise none (SQL allows a table without a key).
function resolvePrimaryKeys(tables, tablesByName) {
  for (const table of tables) {
    let pk = null;
    const id = table.columns.find((col) => col.name.toLowerCase() === 'id');
    if (id) pk = id.name;

    if (!pk) {
      const oneToOne = table.columns.find(
        (col) => col.ref && col.cards && col.cards.source === 'one' && col.cards.target === 'one',
      );
      if (oneToOne) pk = oneToOne.name;
    }

    table.pk = pk ? [pk] : [];
    for (const col of table.columns) col.pk = col.name === pk;

    // Now that every table's key is known, give each foreign key the column and
    // matching type of the row it references.
    for (const col of table.columns) {
      if (!col.ref) continue;
      const referenced = tablesByName.get(col.ref.table);
      col.type = resolveRefType(col.ref.table, tablesByName);
      col.ref.column = resolveRefColumn(referenced, tablesByName);
    }
  }
}

// The full parse result's relations, minus the ones whose foreign key column was
// already built from a to-one reference field. What remains needs its DDL decided
// here: a many-to-many becomes a join table; a one-sided back-reference or an
// explicit anonymous relation gets a synthesised key column on its many side.
function resolveManyColumns(relations, entitiesByTable, tablesByName, joins, seenPairs) {
  for (const relation of relations) {
    const hasToOne = relation.fields.some((ref) => {
      const entity = entitiesByTable.get(ref.entity);
      const field = entity && entity.fields.find((col) => col.name === ref.name);
      return Boolean(field && isToOneRef(field));
    });
    if (hasToOne) continue; // its foreign key column was already emitted

    const sourceSingular = isSingular(relation.sourceCard);
    const targetSingular = isSingular(relation.targetCard);

    const isMany = (sourceSingular || targetSingular) === false;
    if (isMany) {
      addJoinTable(relation, tablesByName, joins, seenPairs);
      continue;
    }

    // Exactly one end is the "one" side: the foreign key column belongs on the
    // other, "many" (or open) side. This fires for anonymous `rel` lines and for
    // one-sided back-references that have no to-one counterpart.
    const manyName = sourceSingular ? relation.target : relation.source;
    const oneName = sourceSingular ? relation.source : relation.target;
    const manyCard = sourceSingular ? relation.targetCard : relation.sourceCard;
    const oneCard = sourceSingular ? relation.sourceCard : relation.targetCard;

    addSynthesizedColumn(manyName, oneName, manyCard, oneCard, tablesByName);
  }
}

// A many-to-many relation has no column on either side, so it is materialised as a
// link table with one foreign key into each end. A self relation is a single end
// referenced twice, so its two keys keep distinct names.
function addJoinTable(relation, tablesByName, joins, seenPairs) {
  const self = relation.source === relation.target;
  const ends = self
    ? [relation.source]
    : [relation.source, relation.target].sort();

  const pairKey = ends.map((name) => name.toLowerCase()).join(' ');
  if (seenPairs.has(pairKey)) return;
  seenPairs.add(pairKey);

  const joinName = self ? `${ends[0]}_${ends[0]}_link` : `${ends[0]}_${ends[1]}`;
  if (tablesByName.has(joinName)) return;

  const specs = self
    ? [`${ends[0].toLowerCase()}_a_id`, `${ends[0].toLowerCase()}_b_id`].map((name) => ({ name, end: ends[0] }))
    : ends.map((end) => ({ name: `${end.toLowerCase()}_id`, end }));

  const columns = specs.map(({ name, end }) => ({
    name,
    type: 'INTEGER',
    pk: false,
    unique: false,
    notNull: true,
    ref: { table: end, column: null },
    cards: null,
  }));

  const table = { name: joinName, columns, pk: [], synthetic: true };
  joins.push(table);
  for (const col of columns) {
    const referenced = tablesByName.get(col.ref.table);
    col.type = resolveRefType(col.ref.table, tablesByName);
    col.ref.column = resolveRefColumn(referenced, tablesByName);
  }
}

// Names a missing foreign key column after the entity it points at, avoiding a
// clash with a column that already exists in the table.
function synthesizedName(base, table) {
  let name = `${String(base).toLowerCase()}_id`;
  const existing = new Set(table.columns.map((col) => col.name.toLowerCase()));
  for (let i = 2; existing.has(name.toLowerCase()); i += 1) {
    name = `${String(base).toLowerCase()}_id_${i - 1}`;
  }
  return name;
}

function addSynthesizedColumn(manyName, oneName, manyCard, oneCard, tablesByName) {
  const table = tablesByName.get(manyName);
  if (!table) return;

  const column = {
    name: synthesizedName(oneName, table),
    type: resolveRefType(oneName, tablesByName),
    pk: false,
    unique: isSingular(manyCard),
    // Mandatory when the referenced ("one") end does not allow zero.
    notNull: isNonZero(oneCard),
    ref: { table: oneName, column: null },
    cards: null,
  };
  column.ref.column = resolveRefColumn(tablesByName.get(oneName), tablesByName);
  table.columns.push(column);
}

// Renders one column definition line, keys and the reference clause included:
//   name TYPE [NOT NULL] [UNIQUE] [PRIMARY KEY] [REFERENCES table (column)]
// A primary key already implies NOT NULL, so the two are not emitted together.
function renderColumn(col) {
  let def = `  ${quote(col.name)} ${col.type || 'TEXT'}`;

  if (col.pk) {
    def += ' PRIMARY KEY';
  } else {
    if (col.notNull) def += ' NOT NULL';
    if (col.unique) def += ' UNIQUE';
  }

  if (col.ref && col.ref.column) {
    def += ` REFERENCES ${quote(col.ref.table)}(${quote(col.ref.column)})`;
  }

  return def;
}

// Emits a table as a CREATE statement. A table with no columns (for example a
// relation-only entity whose link was not resolvable) yields nothing.
function renderTable(table) {
  if (!table.columns.length) return null;

  const defs = table.columns.map(renderColumn);
  if (table.pk.length > 1) {
    defs.push(`  PRIMARY KEY (${table.pk.map((name) => quote(name)).join(', ')})`);
  }

  return `CREATE TABLE ${quote(table.name)} (\n${defs.join(',\n')}\n);`;
}

// Tables are emitted referenced-first so the script runs top to bottom. A stable
// topological sort: among the tables whose dependencies are already emitted, the
// one that appeared earliest in the schema goes next. Cycles fall back to schema
// order so the sort always terminates.
function orderTables(tables) {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const remaining = tables.slice();
  const emitted = new Set();
  const result = [];

  while (remaining.length) {
    const ready = remaining.filter((table) =>
      table.columns.every((col) => !col.ref || col.ref.table === table.name || emitted.has(col.ref.table) || !byName.has(col.ref.table)),
    );
    const pool = ready.length ? ready : remaining;
    pool.sort((a, b) => a.order - b.order);
    const next = pool[0];
    remaining.splice(remaining.indexOf(next), 1);
    emitted.add(next.name);
    result.push(next);
  }

  return result;
}

function modelToSql(model) {
  if (!model || !model.tables.length) return '';
  const statements = model.tables.map(renderTable).filter(Boolean);
  if (!statements.length) return '';
  return `-- Generated by ERDraft (edit freely)\n\n${statements.join('\n\n')}\n`;
}

// Public entry points: a parse result in, a structured model / SQL text out.
function buildSqlModel(parsed) {
  const entities = parsed.entities || [];
  const tables = entities.map((entity, index) => buildTable(entity, index));
  const tablesByName = new Map(tables.map((table) => [table.name, table]));
  const entitiesByName = new Map(entities.map((entity) => [entity.name, entity]));

  resolvePrimaryKeys(tables, tablesByName);

  const joins = [];
  const seenPairs = new Set();
  resolveManyColumns(parsed.relations || [], entitiesByName, tablesByName, joins, seenPairs);
  for (const join of joins) tablesByName.set(join.name, join);

  return { tables: orderTables([...tables, ...joins]) };
}

function erDraftToSql(parsed) {
  return modelToSql(buildSqlModel(parsed));
}
