import test from 'node:test';
import assert from 'node:assert/strict';

import { sqlToErdraft, parseSchema } from '../scripts/load-source.mjs';

function compile(sql) {
  return sqlToErdraft(sql);
}

function fieldOf(parsed, entity, name) {
  return parsed.entities.find((table) => table.name === entity).fields.find(
    (field) => field.name === name,
  );
}

test('maps CREATE TABLE statements to entities and columns to fields', () => {
  const text = compile(
    `CREATE TABLE users (id INTEGER, name TEXT);
CREATE TABLE posts (id INTEGER, title TEXT);`,
  );
  const parsed = parseSchema(text);
  assert.match(text, /^# Imported from SQL/);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(
    parsed.entities.map((entity) => entity.name),
    ['users', 'posts'],
  );
  assert.deepEqual(
    parsed.entities[0].fields.map((field) => [field.name, field.type]),
    [
      ['id', 'INTEGER'],
      ['name', 'TEXT'],
    ],
  );
});

test('turns a column foreign key into a one-sided reference', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL);
CREATE TABLE posts (id SERIAL PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES users(id));`,
    ),
  );
  assert.equal(parsed.errors.length, 0);
  const author = fieldOf(parsed, 'posts', 'author_id');
  // The referencing column is not a key, so it is a one-sided relation: the
  // open (unmarked) declaring end and a single referenced end.
  assert.equal(author.type, 'users[:1]');
  assert.equal(author.reference, 'users');

  const relation = parsed.relations[0];
  assert.equal(relation.source, 'posts');
  assert.equal(relation.target, 'users');
  assert.equal(relation.sourceCard, null);
  assert.equal(relation.targetCard, 'one');
});

test('a nullable foreign key makes the referenced end optional', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE posts (id INTEGER, author_id INTEGER REFERENCES users(id));`,
    ),
  );
  const author = fieldOf(parsed, 'posts', 'author_id');
  assert.equal(author.type, 'users[:1?]');
});

test('a primary-key column referenced as a foreign key is a one-to-one', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE users (id INTEGER PRIMARY KEY);
CREATE TABLE profiles (user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id), bio TEXT);`,
    ),
  );
  assert.equal(fieldOf(parsed, 'profiles', 'user_id').type, 'users[1:1]');
});

test('a reference to a non-unique column is a many-to-many', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE authors (id INTEGER, pen_name TEXT);
CREATE TABLE posts (id INTEGER, author_id INTEGER NOT NULL REFERENCES authors(pen_name));`,
    ),
  );
  assert.equal(fieldOf(parsed, 'posts', 'author_id').type, 'authors[:n]');
});

test('supports self references', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE employee (id INTEGER PRIMARY KEY, name TEXT, manager_id INTEGER REFERENCES employee(id));`,
    ),
  );
  assert.equal(parsed.errors.length, 0);
  const relation = parsed.relations[0];
  assert.equal(relation.source, 'employee');
  assert.equal(relation.target, 'employee');
  assert.equal(fieldOf(parsed, 'employee', 'manager_id').type, 'employee[:1?]');
});

test('a composite foreign key becomes an anonymous relation', () => {
  const text = compile(
    `CREATE TABLE department (code CHAR(4), ver INTEGER, PRIMARY KEY (code, ver));
CREATE TABLE employee (code CHAR(4) NOT NULL, ver INTEGER NOT NULL, FOREIGN KEY (code, ver) REFERENCES department(code, ver));`,
  );
  const parsed = parseSchema(text);
  assert.match(text, /rel department/);
  const relation = parsed.relations.find(
    (item) => item.source === 'employee' && item.target === 'department',
  );
  assert.ok(relation);
  assert.equal(relation.label, '');
});

test('handles a named table-level foreign key', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, email TEXT);
CREATE TABLE orders (id INTEGER, customer_id INTEGER, CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES customers(id));`,
    ),
  );
  assert.equal(parsed.errors.length, 0);
  assert.equal(fieldOf(parsed, 'orders', 'customer_id').type, 'customers[:1?]');
});

test('drops references to tables that were not imported', () => {
  const parsed = parseSchema(
    compile(`CREATE TABLE posts (id INTEGER, a INTEGER REFERENCES missing(id));`),
  );
  assert.equal(parsed.relations.length, 0);
  assert.equal(fieldOf(parsed, 'posts', 'a').reference, undefined);
});

test('deduplicates identical table declarations', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE users (id INTEGER);
CREATE TABLE users (id INTEGER);`,
    ),
  );
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.entities[0].name, 'users');
});

test('sanitizes non-identifier names so the output stays valid ERDraft', () => {
  const parsed = parseSchema(
    compile(`CREATE TABLE "my-table" ("my-column" INTEGER, other TEXT);`),
  );
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.entities[0].name, 'my_table');
  assert.deepEqual(
    parsed.entities[0].fields.map((field) => field.name),
    ['my_column', 'other'],
  );
});

test('keeps multi-word and parameterized types as plain fields', () => {
  const parsed = parseSchema(
    compile(`CREATE TABLE logs (created_at TIMESTAMP WITH TIME ZONE NOT NULL, amount DECIMAL(10,2));`),
  );
  const fields = Object.fromEntries(
    parsed.entities[0].fields.map((field) => [field.name, field.type]),
  );
  assert.equal(fields.created_at, 'TIMESTAMP WITH TIME ZONE');
  assert.equal(fields.amount, 'DECIMAL(10,2)');
});

test('ignores statements that are not CREATE TABLE', () => {
  const parsed = parseSchema(
    compile(
      `-- header comment
DROP TABLE IF EXISTS foo;
CREATE INDEX name_idx ON users(name);
CREATE TABLE t1 (id INTEGER);
CREATE TABLE logs AS SELECT 1;`,
    ),
  );
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(
    parsed.entities.map((entity) => entity.name),
    ['t1'],
  );
});

test('returns empty output when there is no CREATE TABLE', () => {
  assert.equal(sqlToErdraft(''), '');
  assert.equal(sqlToErdraft('-- just a comment\nINSERT INTO t VALUES (1);'), '');
});

test('compiles a realistic schema with zero diagnostics', () => {
  const sql = `
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP
);
CREATE TABLE posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200),
  body TEXT,
  author_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  published_at DATETIME
);
CREATE TABLE post_tags (
  post_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);
CREATE TABLE tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) UNIQUE
);
CREATE TABLE employee (
  id INT PRIMARY KEY,
  manager_id INT REFERENCES employee(id)
);
`;
  const parsed = parseSchema(sqlToErdraft(sql));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.entities.length, 5);
  assert.ok(parsed.relations.every((relation) => relation.source && relation.target));
});

test('reads a foreign key declared out of band with ALTER TABLE', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
CREATE TABLE posts (id INTEGER, author_id INTEGER NOT NULL);
ALTER TABLE posts ADD CONSTRAINT posts_author_fkey FOREIGN KEY (author_id) REFERENCES users(id);`,
    ),
  );
  assert.equal(parsed.errors.length, 0);
  const author = fieldOf(parsed, 'posts', 'author_id');
  assert.equal(author.type, 'users[:1]');
  assert.equal(author.reference, 'users');
});

test('a unique key declared via ALTER TABLE counts toward cardinality', () => {
  const parsed = parseSchema(
    compile(
      `CREATE TABLE categories (id INTEGER, slug TEXT);
ALTER TABLE categories ADD CONSTRAINT categories_slug_key UNIQUE (slug);
CREATE TABLE articles (id INTEGER, category_slug TEXT NOT NULL);
ALTER TABLE articles ADD CONSTRAINT articles_category_fkey FOREIGN KEY (category_slug) REFERENCES categories(slug);`,
    ),
  );
  // Referencing a column made unique by the ALTER is a one on the other end.
  assert.equal(fieldOf(parsed, 'articles', 'category_slug').type, 'categories[:1]');
});

test('works for an ALTER whose table is only ever referenced (no CREATE)', () => {
  const text = compile(
    `CREATE TABLE departments (id INTEGER PRIMARY KEY);
ALTER TABLE departments ADD CONSTRAINT departments_code_key UNIQUE (code);`,
  );
  const parsed = parseSchema(text);
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.entities[0].name, 'departments');
});

test('compiles a Postgres-style dump with ALTERs and DML noise', () => {
  const sql = `
CREATE TABLE department (
    id serial PRIMARY KEY NOT NULL,
    name character varying(15) NOT NULL,
    managerstart date,
    manager integer
);
ALTER TABLE ONLY department ADD CONSTRAINT department_name_key UNIQUE (name);

CREATE TABLE department_location (
    department integer NOT NULL,
    location character varying(15) NOT NULL
);
ALTER TABLE department_location ADD CONSTRAINT department_location_department_fkey FOREIGN KEY (department) REFERENCES department(id);

CREATE TABLE employee (
    id serial PRIMARY KEY NOT NULL,
    firstname character varying(15) NOT NULL,
    lastname character varying(15) NOT NULL,
    ssn character(9) NOT NULL,
    salary numeric(10,2),
    supervisor integer,
    department integer NOT NULL
);
ALTER TABLE employee ADD CONSTRAINT employee_ssn_key UNIQUE (ssn);
INSERT INTO department (id, name) VALUES (1, 'Headquarters');
INSERT INTO employee (id, department, supervisor) VALUES (1, 7, NULL);
SELECT pg_catalog.setval('department_id_seq', 8, true);

CREATE TABLE dependent (
    employee integer NOT NULL,
    name character varying(15) NOT NULL
);
ALTER TABLE dependent ADD CONSTRAINT dependent_employee_fkey FOREIGN KEY (employee) REFERENCES employee(id);

CREATE TABLE project (
    id serial PRIMARY KEY NOT NULL,
    name character varying(15) NOT NULL,
    department integer NOT NULL
);
ALTER TABLE project ADD CONSTRAINT project_name_key UNIQUE (name);
ALTER TABLE project ADD CONSTRAINT project_department_fkey FOREIGN KEY (department) REFERENCES department(id);

CREATE TABLE works_on (
    employee integer NOT NULL,
    project integer NOT NULL,
    hours numeric(3,1) NOT NULL
);
ALTER TABLE works_on ADD CONSTRAINT works_on_employee_project_key UNIQUE (employee, project);
ALTER TABLE works_on ADD CONSTRAINT works_on_employee_fkey FOREIGN KEY (employee) REFERENCES employee(id);
ALTER TABLE works_on ADD CONSTRAINT works_on_project_fkey FOREIGN KEY (project) REFERENCES project(id);

ALTER TABLE department ADD CONSTRAINT department_manager_fkey FOREIGN KEY (manager) REFERENCES employee(id);
ALTER TABLE employee ADD CONSTRAINT employee_department_fkey FOREIGN KEY (department) REFERENCES department(id);
ALTER TABLE employee ADD CONSTRAINT employee_supervisor_fkey FOREIGN KEY (supervisor) REFERENCES employee(id);
`;
  const parsed = parseSchema(sqlToErdraft(sql));
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(
    parsed.entities.map((entity) => entity.name).sort(),
    ['department', 'department_location', 'dependent', 'employee', 'project', 'works_on'],
  );

  // Long types survive import intact.
  assert.equal(fieldOf(parsed, 'department', 'name').type, 'character varying(15)');
  assert.equal(fieldOf(parsed, 'employee', 'salary').type, 'numeric(10,2)');

  // Out-of-band foreign keys resolved with their keys and nullability. Each
  // referencing column is a plain (non-key) column, so every edge is
  // one-sided: only the referenced end is marked, the declaring end is open.
  assert.equal(fieldOf(parsed, 'employee', 'department').type, 'department[:1]');
  assert.equal(fieldOf(parsed, 'employee', 'supervisor').type, 'employee[:1?]');
  assert.equal(fieldOf(parsed, 'department', 'manager').type, 'employee[:1?]');
  assert.equal(fieldOf(parsed, 'works_on', 'employee').type, 'employee[:1]');
  assert.equal(fieldOf(parsed, 'works_on', 'project').type, 'project[:1]');
  assert.equal(fieldOf(parsed, 'dependent', 'employee').type, 'employee[:1]');

  // Every referenced target exists, so no dangling relations.
  const names = new Set(parsed.entities.map((entity) => entity.name));
  assert.ok(parsed.relations.length > 0);
  for (const relation of parsed.relations) {
    assert.ok(names.has(relation.source));
    assert.ok(names.has(relation.target));
  }
});
