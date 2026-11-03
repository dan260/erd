# ERDraft

 A minimalist ER-diagram editor that runs entirely in the browser.
 The schema is described in text, and the visual diagram is built
automatically on the right. The result can be exported to the
editable `.drawio` format, or saved as a `.png` image.

**Open the app:** [https://dan260.github.io/erd/](https://dan260.github.io/erd/)

## Features

- The text is the single source of the diagram. No manual layout needed.
- Relations are built automatically from field types.
- Cardinality: `1`, `n`, `1?`, `n?`.
- Explicit cardinality syntax: `author: User[n:1]`, `posts: Post[1:n]`.
- Relations described from both sides are merged.
- Self references of an entity.
- Anonymous relations: `rel Target[1:n]` inside an entity — a line
  without a field.
- Export to `.drawio` (draw.io / diagrams.net) or to `.png`.
- Save the schema to a file and load it from a file (`.erdraft`).
- Autosaving of the text in `localStorage`.
- Zoom, panning, and automatic fitting of the diagram.
- English and Russian interfaces (English by default).
- Light and dark appearance, with a "follow the system" option.
- Syntax highlighting in the editor.
- Automatic bracket pairing: type `{` or `[`, the closing partner is
  added and the caret stays between them; typing a closer right after
  its opener just moves the caret.
- `Tab` / `Shift+Tab` indent and outdent, including whole selections.
- No server, no build step, no external dependencies.

## Running

Double-click `index.html` — the app works directly from the file
without a build step or a local server.

If the browser restricts `localStorage` for `file://`, or you want an
environment as close to GitHub Pages as possible, start a static server:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any other static server works too,
e.g. `npx serve .`.

## Publishing to GitHub Pages

The project needs no build step:

1. Upload the repository contents to GitHub.
2. Open **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Pick the branch (for example, `main`) and the folder `/ (root)`.

## Interface language

The language selector lives in the header, next to the export button.
The default is English; the choice is stored in `localStorage`, along
with the schema. Switching immediately relays the interface, error
messages, and diagram labels.

## Appearance

The theme selector next to the language one switches the interface
between **Light** and **Dark**, or follows the operating system with
**System** (the default). The choice is remembered and applied before
the first paint, so there is no flash of the wrong theme. The SVG
palette of the diagram cards is independent of the theme and stays the
same in both.

The editor highlights `entity` / `rel` keywords, names, fields, types,
explicit cardinality, and `#` / `//` comments, and keeps the line
numbers and the highlighted layer in sync with the text.

## Syntax

```text
entity User {
  id: int
  name: string
  email
  posts: Post[1:n]
}

entity Post {
  id: int
  title: string
  author: User[n:1]
}
```

- `entity Name { ... }` — an entity and its fields, one per line.
- `field` — a field without a type.
- `field: type` — a field with a type.
- If a type matches an entity name, the field is a reference to it.
  For example, `author: User` creates the relation `Post → User`.
- `Post[1:n]` — an explicit one-to-many relation.
- `User[n:1?]` — an optional relation, “0 or 1”.
- `Post[1:n?]` — a relation, “one to 0..n”.
- `rel Target[1:n]` inside an entity — an anonymous relation: a line
  without a field.
- Lines starting with `#` or `//` are comments.

### Explicit cardinality

The cardinality is written right in the type: `Post[1:n]`, `User[n:1]`,
`User[1:1]`, `Role[n:n]`.

The values read as `[field owner:target entity]`:

```text
entity User {
  posts: Post[1:n]     # one User — many Post
}

entity Post {
  author: User[n:1]    # many Post — one User
}
```

To make a relation optional, add `?` to the side that may be absent:

- `1?` — 0 or 1;
- `n?` — zero or more.

```text
entity Comment {
  author: User[n:1?]   # a User has many Comments, a Comment has 0 or 1 author
}
```

The old forms `Post[]` and `User?` are no longer supported — use
`Post[1:n]` and `User[n:1?]` instead. A plain reference,
`author: User`, still creates a relation with the default
cardinality.

If a field with an explicit cardinality is merged with an
outgoing field that has none, the explicit cardinality wins.

### Relations from both sides

```text
entity User {
  posts: Post[1:n]
}

entity Post {
  author: User[n:1]
}
```

`User.posts` and `Post.author` describe the same relation, so the
diagram shows a single line. If several different fields reference one
entity, for example `author` and `editor`, separate relations are
drawn.

### Self references

```text
entity Employee {
  manager: Employee[n:1?]
}
```

### Anonymous relations

A `rel` line declares a relation from the enclosing entity to the named
one, without adding a field to the entity card:

```text
entity Notification {
  id: int
  created_at: datetime
  rel User[1:n]
}
```

- The cardinality is required, for example `rel User[1:n]` or
  `rel User[0..1:1]`. Without brackets the line is reported as an error.
- It reads `[declaring entity : target]`, like the explicit cardinality.
- An entity may declare as many relations as needed, even to the same
  target.
- When the same pair is described from the other side (a reference
  field or a `rel` line), the two sides merge into a single line.
- The link is exported to `.drawio` as an edge without a label.

`rel` is a reserved word: `rel: string` is still a field, but a line
written as `rel Target` without a colon is parsed as a relation.

## Files

The schema is plain text and can be stored in a file with the
`.erdraft` extension.

- The **Save** / **Open** buttons in the editor footer write the
  current text to `erdraft-schema.erdraft` and read it back.
- `Ctrl/Cmd + S` saves the schema to a file.

Loaded content goes through the same pipeline as typed text: it is
parsed, validated, and autosaved. Files larger than 1 MB or with
binary content are rejected with a notification.

## Diagram controls

- Mouse wheel — zoom.
- Dragging the background — panning.
- Double-click on the canvas — fit the diagram.
- `Tab` in the editor — indent the caret line, or every line of a
  selection. `Shift+Tab` — the reverse.
- `Ctrl/Cmd + E` — export `.drawio`.
- `Ctrl/Cmd + Shift + E` — export `.png`.
- **Save** / **Open** buttons in the editor footer — write the schema
  to a `.erdraft` file and load it from a file.
- `Ctrl/Cmd + S` — save the schema to a file.

## Tests

```bash
npm test
```

The tests use the built-in Node.js test runner and need no
dependencies.

## Structure

```text
index.html          application interface
styles.css          styling
src/app.js          application state and interactions
src/i18n.js         interface strings (en/ru)
src/parser.js       text schema parser
src/layout.js       automatic layout
src/render.js       SVG rendering
src/drawio.js       .drawio generation
src/png.js          .png rendering
src/theme.js        diagram palette
src/highlight.js    editor syntax highlighting
src/appearance.js   light/dark/system theme
test/               unit tests
scripts/            source loader for tests
```
