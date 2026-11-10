import test from 'node:test';
import assert from 'node:assert/strict';

import { sqlToErdraft, parseSchema, buildSqlModel, modelToSql, erDraftToSql, sqlType } from '../scripts/load-source.mjs';

// export(parse(erdraft)) — the same pipeline the app runs.
function exportText(erdraft) {
  return erDraftToSql(parseSchema(erdraft));
}

// export → import → export; the two SQL texts must be identical for the compiler
// to be a stable inverse of the import.
function roundTripIsStable(erdraft) {
  const sql1 = exportText(erdraft);
  const sql2 = exportText(sqlToErdraft(sql1));
  return { sql1, sql2, stable: sql1 === sql2 };
}

// export(parse(import(sql))) → import → export, starting from raw SQL DDL.
function sqlRoundTripIsStable(sql) {
  const erdraft = sqlToErdraft(sql);
  return roundTripIsStable(erdraft);
}

// Finds one table's column in a model by name.
function column(model, table, name) {
  return model.tables.find((t) => t.name === table).columns.find((c) => c.name === name);
}

test('maps ERDraft shorthand types to canonical SQL', () => {
  assert.equal(sqlType('int'), 'INTEGER');
  assert.equal(sqlType('string'), 'TEXT');
  assert.equal(sqlType('bool'), 'BOOLEAN');
  assert.equal(sqlType('datetime'), 'TIMESTAMP');
  assert.equal(sqlType('float'), 'DOUBLE PRECISION');
});

test('keeps type parameters and is idempotent on its own output', () => {
  assert.equal(sqlType('varchar(255)'), 'VARCHAR(255)');
  assert.equal(sqlType('character varying(15)'), 'VARCHAR(15)');
  assert.equal(sqlType('VARCHAR(15)'), 'VARCHAR(15)');
  assert.equal(sqlType('DECIMAL(10,2)'), 'DECIMAL(10,2)');
});

test('passes already-SQL or unknown types through unchanged', () => {
  assert.equal(sqlType('customtype'), 'customtype');
  assert.equal(sqlType('TIMESTAMPTZ'), 'TIMESTAMPTZ');
});

test('derives NOT NULL from the referenced end and UNIQUE from the declaring end', () => {
  const model = buildSqlModel(
    parseSchema(
      `entity User {
  id: int
  posts: Post[1:n]
}
entity Post {
  id: int
  author: User[n:1]
  editor: User[n:1?]
}`,
    ),
  );

  const author = column(model, 'Post', 'author');
  assert.deepEqual(author.ref, { table: 'User', column: 'id' });
  assert.equal(author.type, 'INTEGER');
  assert.equal(author.notNull, true);
  assert.equal(author.unique, false);
  assert.equal(author.pk, false);

  const editor = column(model, 'Post', 'editor');
  assert.equal(editor.notNull, false); // referenced end allows zero
  assert.equal(editor.unique, false);

  // A to-many back reference emits a column neither is a foreign key.
  const posts = column(model, 'User', 'posts');
  assert.equal(posts, undefined);
});

test('a mandatory one-to-one foreign key becomes the primary key', () => {
  const model = buildSqlModel(
    parseSchema(
      `entity User {
  id: int
  name: string
}
entity Profile {
  user: User[1:1]
  bio: string
}`,
    ),
  );

  const user = column(model, 'Profile', 'user');
  assert.equal(user.pk, true);
  assert.equal(user.unique, true);
  assert.equal(user.notNull, true);
  assert.equal(model.tables.find((t) => t.name === 'Profile').pk[0], 'user');

  // The id wins when both an id and a 1:1 key exist.
  const id = column(model, 'User', 'id');
  assert.equal(id.pk, true);
});

test('a many-to-many relation becomes a link table', () => {
  const model = buildSqlModel(
    parseSchema(
      `entity Post {
  id: int
  tags: Tag[n:n]
}
entity Tag {
  id: int
  name: string
  posts: Post[n:n]
}`,
    ),
  );

  const join = model.tables.find((t) => t.name === 'Post_Tag');
  assert.ok(join, 'a Post_Tag link table is emitted');
  assert.deepEqual(
    join.columns.map((c) => [c.name, c.ref.table]),
    [
      ['post_id', 'Post'],
      ['tag_id', 'Tag'],
    ],
  );
  // Neither end has a column of its own.
  assert.equal(column(model, 'Post', 'tags'), undefined);
  assert.equal(column(model, 'Tag', 'posts'), undefined);
});

test('a self reference exports as a foreign key to the same table', () => {
  const model = buildSqlModel(
    parseSchema(
      `entity Employee {
  id: int
  name: string
  manager: Employee[n:1?]
}`,
    ),
  );
  const manager = column(model, 'Employee', 'manager');
  assert.equal(manager.ref.table, 'Employee');
  assert.equal(manager.ref.column, 'id');
  assert.equal(manager.notNull, false);
});

test('an anonymous rel gets a foreign key on its many side', () => {
  const model = buildSqlModel(
    parseSchema(
      `entity Notification {
  id: int
  rel User[1:n]
}
entity User {
  id: int
  name: string
}`,
    ),
  );
  const synthetic = column(model, 'User', 'notification_id');
  assert.ok(synthetic, 'a notification_id key is synthesised on the many side');
  assert.equal(synthetic.ref.table, 'Notification');
});

test('orders tables referenced-first', () => {
  const sql = exportText(
    `entity Post {
  id: int
  author: User[n:1]
}
entity User {
  id: int
  posts: Post[1:n]
}`,
  );
  const userAt = sql.indexOf('CREATE TABLE User');
  const postAt = sql.indexOf('CREATE TABLE Post');
  assert.ok(userAt !== -1 && postAt !== -1);
  assert.ok(userAt < postAt, 'the referenced table is emitted before the one that uses it');
});

test('round-trips a one-to-many schema stably', () => {
  const { sql1, sql2, stable } = sqlRoundTripIsStable(
    `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER NOT NULL REFERENCES users(id));`,
  );
  assert.ok(stable, `\n--- first ---\n${sql1}\n--- second ---\n${sql2}`);
});

test('round-trips a one-to-one, many-to-many and self schema stably', () => {
  const { sql1, sql2, stable } = sqlRoundTripIsStable(
    `CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL);
CREATE TABLE profiles (user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id), bio TEXT);
CREATE TABLE posts (id SERIAL PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE post_tag (post_id INTEGER NOT NULL REFERENCES posts(id), tag_id INTEGER NOT NULL REFERENCES tags(id));
CREATE TABLE tags (id SERIAL PRIMARY KEY, name TEXT);
CREATE TABLE employees (id SERIAL PRIMARY KEY, manager_id INTEGER REFERENCES employees(id));`,
  );
  assert.ok(stable, `\n--- first ---\n${sql1}\n--- second ---\n${sql2}`);
});

test('round-trips a hand-written schema stably once normalised', () => {
  const first = roundTripIsStable(
    `entity User {
  id: int
  name: string
  posts: Post[1:n]
}
entity Post {
  id: int
  title: string
  author: User[n:1]
}`,
  );
  // A hand-written 1:n whose back reference is the only to-many expression
  // stabilises after one pass: import the generated SQL, then re-export.
  const { sql1, sql2, stable } = roundTripIsStable(sqlToErdraft(first.sql1));
  assert.ok(stable, `\n--- first ---\n${sql1}\n--- second ---\n${sql2}`);
  assert.ok(first.sql1.length > 0);
});

test('emits nothing for an empty schema', () => {
  assert.equal(modelToSql({ tables: [] }), '');
});
