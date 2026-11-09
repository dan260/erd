import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSchema } from '../scripts/load-source.mjs';

test('parses entities, comments and optional field types', () => {
  const result = parseSchema(`# Blog schema
entity User {
  id: int
  name
  email: string
}

// A second entity
entity Post {
  id: int
  title: string
}`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.entities.map((entity) => entity.name),
    ['User', 'Post'],
  );
  assert.deepEqual(
    result.entities[0].fields.map((field) => [field.name, field.type]),
    [
      ['id', 'int'],
      ['name', ''],
      ['email', 'string'],
    ],
  );
  assert.equal(result.entities[0].line, 2);
  assert.equal(result.entities[0].closeLine, 6);
  assert.equal(result.entities[1].line, 9);
  assert.equal(result.entities[1].closeLine, 12);
});

test('treats the entity keyword as optional', () => {
  const result = parseSchema(`User {
  id: int
  name
  posts: Post[1:n]
}

Post {
  id: int
  title: string
  author: User[n:1]
}`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.entities.map((entity) => entity.name),
    ['User', 'Post'],
  );
  assert.deepEqual(
    result.entities[0].fields.map((field) => [field.name, field.type]),
    [
      ['id', 'int'],
      ['name', ''],
      ['posts', 'Post[1:n]'],
    ],
  );
  assert.equal(result.entities[0].line, 1);
  assert.equal(result.entities[0].closeLine, 5);
  assert.equal(result.relations.length, 1);
});

test('mixes keyword and keyword-less entities', () => {
  const result = parseSchema(`entity User {
  id: int
}

Post {
  id: int
  author: User[n:1]
}`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.entities.map((entity) => entity.name),
    ['User', 'Post'],
  );
});

test('parses a keyword-less empty entity and empty entity with the keyword', () => {
  const result = parseSchema(`Empty {}
entity Filled {}
Solo {}`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.entities.map((entity) => entity.name),
    ['Empty', 'Filled', 'Solo'],
  );
});

test('parses an entity whose name is the word entity', () => {
  const result = parseSchema(`entity {
  id: int
}`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.entities.map((entity) => entity.name),
    ['entity'],
  );
});

test('does not swallow a name that merely starts with entity', () => {
  const result = parseSchema(`entityUser {
  id: int
}`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.entities.map((entity) => entity.name),
    ['entityUser'],
  );
});

test('merges reciprocal explicit relationships', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[1:n]
}

entity Post {
  id: int
  title: string
  author: User[n:1]
}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 1);

  const [relation] = result.relations;
  assert.equal(relation.source, 'User');
  assert.equal(relation.target, 'Post');
  assert.equal(relation.sourceCard, 'one');
  assert.equal(relation.targetCard, 'many');
  assert.equal(relation.label, 'posts / author');
  assert.equal(relation.fields.length, 2);
});

test('keeps conflicting reciprocal references as separate relationships', () => {
  // `department.manager` and `employee.department` are two *different*
  // foreign keys between the same pair: the employee end reads 0..1 on one
  // line but many on the other, so they are not one relation seen from both
  // ends and must not be merged (merging would collapse both ends to many ->
  // a false n:n edge).
  const result = parseSchema(`entity department {
  id: int
  manager: employee[n:1?]
}

entity employee {
  id: int
  department: department[n:1]
}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 2);

  const manager = result.relations.find((relation) =>
    relation.fields.some((field) => field.name === 'manager'),
  );
  const department = result.relations.find((relation) =>
    relation.fields.some((field) => field.name === 'department'),
  );

  assert.equal(manager.source, 'department');
  assert.equal(manager.target, 'employee');
  assert.equal(manager.sourceCard, 'many');
  assert.equal(manager.targetCard, 'zeroOne');

  assert.equal(department.source, 'employee');
  assert.equal(department.target, 'department');
  assert.equal(department.sourceCard, 'many');
  assert.equal(department.targetCard, 'one');
});

test('supports optional cardinalities and self references', () => {
  const result = parseSchema(`entity User {
  id: int
  manager: User[n:1?]
  posts: Post[1:n]
}

entity Post {
  id: int
  author: User[n:1]
}

entity Tag {
  id: int
  posts: Post[1:n?]
}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 3);

  const self = result.relations.find(
    (relation) => relation.source === 'User' && relation.target === 'User',
  );
  assert.ok(self);
  assert.equal(self.sourceCard, 'many');
  assert.equal(self.targetCard, 'zeroOne');

  const tags = result.relations.find(
    (relation) => relation.fields[0].name === 'posts' && relation.source === 'Tag',
  );
  assert.ok(tags);
  assert.equal(tags.sourceCard, 'one');
  assert.equal(tags.targetCard, 'zeroMany');
});

test('does not turn unknown types into references', () => {
  const result = parseSchema(`entity Event {
  id: int
  happened_at: timestamp with time zone
  payload: json
  vector: float[3]
}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 0);
  assert.equal(
    result.entities[0].fields[1].type,
    'timestamp with time zone',
  );
  assert.equal(result.entities[0].fields[3].type, 'float[3]');
});

test('supports empty entities and accepts fields separated by whitespace', () => {
  const result = parseSchema(`entity Empty {}
entity User {
  id int
  name string
}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.entities.length, 2);
  assert.equal(result.entities[1].fields[0].type, 'int');
});

test('reports malformed source with line numbers', () => {
  const result = parseSchema(`entity User {
  id: int
  first name: string
}

entity User {
  broken: yes
}`);

  assert.equal(result.errors.length, 2);
  assert.ok(
    result.errors.some(
      (error) =>
        error.line === 3 && error.message.includes('Field names'),
    ),
  );
  assert.ok(
    result.errors.some(
      (error) =>
        error.line === 6 && error.message.includes('already declared'),
    ),
  );
});

test('reports an unclosed entity', () => {
  const result = parseSchema(`entity User {
  id: int`);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 1);
  assert.match(result.errors[0].message, /not closed/);
});

test('treats a bare keyword-less word as an attempted entity', () => {
  const result = parseSchema(`hello`);
  assert.match(result.errors[0].message, /opening brace/);
});

test('still reports a missing entity for a line that is not an entity', () => {
  const result = parseSchema(`hello world`);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /declaration/);
});

test('recovers when a new entity starts before the previous one is closed', () => {
  const result = parseSchema(`entity User {
  id: int
entity Post {
  id: int
}`);
  assert.ok(result.errors.length > 0);
  assert.ok(result.entities.some((entity) => entity.name === 'Post'));
  assert.ok(result.errors[0].message.includes('not closed'));
});

test('keeps multiple fields on one side as separate relationships', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[1:n]
  edited_posts: Post[1:n]
}

entity Post {
  id: int
  author: User[n:1]
  editor: User[n:1]
}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 4);
  assert.deepEqual(
    result.relations.map((relation) => relation.label).sort(),
    ['author', 'edited_posts', 'editor', 'posts'],
  );
});


test('supports explicit cardinalities on references', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[1:n]
}

entity Post {
  id: int
  author: User[n:1]
}

entity Profile {
  id: int
  user: User[1:1]
}

entity Role {
  id: int
  users: User[n:n]
}

entity Invite {
  id: int
  sender: User[0..1:N]
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 4);

  const posts = result.relations.find((relation) =>
    relation.fields.some((field) => field.name === 'posts'),
  );
  assert.ok(posts);
  assert.equal(posts.source, 'User');
  assert.equal(posts.target, 'Post');
  assert.equal(posts.sourceCard, 'one');
  assert.equal(posts.targetCard, 'many');

  const profile = result.relations.find(
    (relation) => relation.source === 'Profile',
  );
  assert.equal(profile.sourceCard, 'one');
  assert.equal(profile.targetCard, 'one');

  const role = result.relations.find(
    (relation) => relation.source === 'Role',
  );
  assert.equal(role.sourceCard, 'many');
  assert.equal(role.targetCard, 'many');

  const invite = result.relations.find(
    (relation) => relation.source === 'Invite',
  );
  assert.equal(invite.sourceCard, 'zeroOne');
  assert.equal(invite.targetCard, 'many');
});

test('lets explicit cardinality override a plain reference', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post
}

entity Post {
  id: int
  author: User[1:1]
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].sourceCard, 'one');
  assert.equal(result.relations[0].targetCard, 'one');
});

test('reports invalid or conflicting cardinality syntax', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[1:x]
  edited: Post[n:1][]
}

entity Post {
  id: int
}`);

  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /in the form/);
  assert.equal(result.errors[1].line, 4);
  assert.match(result.errors[1].message, /inside the brackets/);
  assert.equal(result.relations.length, 0);
});


test('supports question-mark cardinality shorthand', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[n?:1]
}

entity Post {
  id: int
  author: User[1:n?]
}

entity Profile {
  id: int
  user: User[1?:1?]
}

entity Role {
  id: int
  users: User[n?:n?]
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 3);

  const posts = result.relations.find(
    (relation) => relation.source === 'User',
  );
  assert.equal(posts.sourceCard, 'zeroMany');
  assert.equal(posts.targetCard, 'one');

  const profile = result.relations.find(
    (relation) => relation.source === 'Profile',
  );
  assert.equal(profile.sourceCard, 'zeroOne');
  assert.equal(profile.targetCard, 'zeroOne');

  const role = result.relations.find(
    (relation) => relation.source === 'Role',
  );
  assert.equal(role.sourceCard, 'zeroMany');
  assert.equal(role.targetCard, 'zeroMany');
});

test('reports old array and optional reference syntax', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[]
  manager: User?
}

entity Post {
  id: int
}`);

  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /Legacy type “Post\[\]”/);
  assert.match(result.errors[0].message, /Post\[1:n\]/);
  assert.equal(result.errors[1].line, 4);
  assert.match(result.errors[1].message, /Legacy type “User\?”/);
  assert.match(result.errors[1].message, /User\[n:1\?\]/);
  assert.equal(result.relations.length, 0);
});

test('reports unbalanced square brackets in type', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[1:n
}

entity Post {
  id: int
}`);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /Unbalanced square brackets/);
  assert.equal(result.relations.length, 0);
});

test('reports duplicated cardinality brackets', () => {
  const result = parseSchema(`entity User {
  id: int
  posts: Post[1:n][1:1]
}

entity Post {
  id: int
  author: User[n:1]
}`);

  assert.ok(result.errors.length >= 1);
  assert.ok(
    result.errors.some((e) => e.line === 3),
    'expected error on line 3',
  );
});

test('creates an anonymous relation declared inside an entity', () => {
  const result = parseSchema(`entity Notification {
  id: int
  rel User[1:n]
}

entity User {
  id: int
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 1);

  const [relation] = result.relations;
  assert.equal(relation.source, 'Notification');
  assert.equal(relation.target, 'User');
  assert.equal(relation.sourceCard, 'one');
  assert.equal(relation.targetCard, 'many');
  assert.equal(relation.label, '');
  assert.equal(relation.fields.length, 0);

  const [notification] = result.entities;
  assert.deepEqual(
    notification.fields.map((field) => field.name),
    ['id'],
  );
});

test('allows multiple anonymous relations per entity', () => {
  const result = parseSchema(`entity User {
  id: int
  rel Post[1:n]
  rel Tag[1:1]
}

entity Post {
  id: int
}

entity Tag {
  id: int
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 2);
  assert.deepEqual(
    result.entities[0].fields.map((field) => field.name),
    ['id'],
  );

  const toPost = result.relations.find(
    (relation) => relation.source === 'User' && relation.target === 'Post',
  );
  const toTag = result.relations.find(
    (relation) => relation.source === 'User' && relation.target === 'Tag',
  );
  assert.ok(toPost && toTag);
  assert.equal(toPost.sourceCard, 'one');
  assert.equal(toPost.targetCard, 'many');
  assert.equal(toTag.sourceCard, 'one');
  assert.equal(toTag.targetCard, 'one');
});

test('requires explicit cardinality on a relation line', () => {
  const result = parseSchema(`entity User {
  rel Post
  posts
}

entity Post {
  id: int
}`);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
  assert.match(
    result.errors[0].message,
    /requires explicit cardinality/,
  );
  assert.equal(result.relations.length, 0);
  assert.deepEqual(
    result.entities[0].fields.map((field) => field.name),
    ['posts'],
  );
});

test('reports malformed relation lines', () => {
  const result = parseSchema(`entity User {
  rel
  rel 9lives[1:n]
}

entity Post {
  id: int
}`);

  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].line, 2);
  assert.match(result.errors[0].message, /rel Post\[1:n\]/);
  assert.equal(result.errors[1].line, 3);
  assert.match(result.errors[1].message, /only contain letters/);
  assert.equal(result.relations.length, 0);
});

test('reports a relation to an undeclared entity', () => {
  const result = parseSchema(`entity User {
  id: int
  rel Ghost[1:n]
}

entity Post {
  id: int
}`);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].message, /Ghost/);
  assert.match(result.errors[0].message, /not declared/);
  assert.equal(result.relations.length, 0);
});

test('merges reciprocal anonymous relations on both sides', () => {
  const result = parseSchema(`entity User {
  rel Post[1:n]
}

entity Post {
  rel User[n:1]
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 1);

  const [relation] = result.relations;
  assert.equal(relation.source, 'User');
  assert.equal(relation.target, 'Post');
  assert.equal(relation.sourceCard, 'one');
  assert.equal(relation.targetCard, 'many');
  assert.equal(relation.label, '');
  assert.equal(relation.fields.length, 0);
});

test('merges a relation line with a reciprocal reference field', () => {
  const result = parseSchema(`entity User {
  rel Post[1:n]
}

entity Post {
  author: User[n:1]
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 1);

  const [relation] = result.relations;
  assert.equal(relation.source, 'User');
  assert.equal(relation.target, 'Post');
  assert.equal(relation.sourceCard, 'one');
  assert.equal(relation.targetCard, 'many');
  assert.equal(relation.label, 'author');
  assert.equal(relation.fields.length, 1);
});

test('supports anonymous self relations', () => {
  const result = parseSchema(`entity Employee {
  id: int
  rel Employee[1?:1]
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 1);

  const [relation] = result.relations;
  assert.equal(relation.source, 'Employee');
  assert.equal(relation.target, 'Employee');
  assert.equal(relation.sourceCard, 'zeroOne');
  assert.equal(relation.targetCard, 'one');
  assert.equal(relation.label, '');
});

test('keeps a field named rel when written with a colon', () => {
  const result = parseSchema(`entity User {
  rel: string
}`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.relations.length, 0);
  assert.deepEqual(
    result.entities[0].fields.map((field) => [field.name, field.type]),
    [['rel', 'string']],
  );
});

test('treats a top-level rel line as a missing entity', () => {
  const result = parseSchema(`rel User[1:n]

entity User {
  id: int
}`);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 1);
  assert.match(result.errors[0].message, /Expected an/);
  assert.equal(result.relations.length, 0);
});
