'use strict';

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const ENTITY_OPEN = /^entity\s+([^\s{}]+)\s*\{$/u;
const ENTITY_EMPTY = /^entity\s+([^\s{}]+)\s*\{\s*\}\s*$/u;
const ENTITY_BARE = /^entity\s+([^\s{}]+)\s*$/u;
const RELATION_LINE = /^rel(?:\s|$)/u;

function cleanType(type) {
  return type.trim().replace(/;$/, '').trim();
}

function parseCardinality(value) {
  const parts = String(value).trim().toLowerCase().split(':');
  if (parts.length !== 2) return null;

  const normalize = (part) => {
    let token = part.trim();
    const optional =
      token.endsWith('?') || token.startsWith('?');

    if (token.endsWith('?')) token = token.slice(0, -1).trim();
    if (token.startsWith('?')) token = token.slice(1).trim();

    let card = null;
    if (token === '1') card = 'one';
    else if (token === 'n' || token === '*' || token === 'many') {
      card = 'many';
    } else if (token === '1..n' || token === '1..*') {
      card = 'many';
    } else if (token === '0..1' || token === 'optional') {
      card = 'zeroOne';
    } else if (
      token === '0..n' ||
      token === '0..*' ||
      token === 'zero..n' ||
      token === 'zero..*'
    ) {
      card = 'zeroMany';
    }

    if (!card) return null;
    if (!optional) return card;
    if (card === 'one') return 'zeroOne';
    if (card === 'many') return 'zeroMany';
    return card;
  };

  const source = normalize(parts[0]);
  const target = normalize(parts[1]);
  if (!source || !target) return null;
  return { source, target };
}

function parseTypeModifiers(type) {
  let base = type.trim();
  let legacyArray = false;
  let legacyOptional = false;
  let cardinality = null;
  let error = null;
  let changed = true;

  while (changed && base) {
    changed = false;

    if (base.endsWith('?')) {
      legacyOptional = true;
      base = base.slice(0, -1).trim();
      changed = true;
      continue;
    }

    if (base.endsWith(']')) {
      const open = base.lastIndexOf('[');
      if (open !== -1) {
        const content = base.slice(open + 1, -1).trim();

        if (!content || content.includes(':')) {
          base = base.slice(0, open).trim();
          changed = true;
        }

        if (!content) {
          legacyArray = true;
        } else if (content.includes(':')) {
          if (cardinality) {
            error = error || I18N.t('diag.oneCardinality');
          } else {
            const parsed = parseCardinality(content);
            if (parsed) {
              cardinality = parsed;
            } else {
              error = error || I18N.t('diag.invalidCardinality');
            }
          }
        }
      }
    }
  }

  const openCount = (base.match(/\[/g) || []).length;
  const closeCount = (base.match(/\]/g) || []).length;
  if (openCount !== closeCount) {
    error = error || I18N.t('diag.unbalanced', { type });
  }

  if (cardinality && (legacyArray || legacyOptional)) {
    error = I18N.t('diag.combinedLegacy');
  }

  return {
    baseType: base,
    legacyArray,
    legacyOptional,
    cardinality,
    error,
  };
}

/**
 * Parses a `rel Target[1:n]` line: an anonymous relation declared inside an
 * entity. No field is created, only the link. The explicit cardinality is
 * required, so any shape without `[owner:target]` is reported.
 */
function consumeRelationLine(body, lineNo, error, relations) {
  const typeInfo = body ? parseTypeModifiers(body) : null;

  if (!typeInfo) {
    error(lineNo, I18N.t('diag.relationSyntax'));
    return;
  }
  if (typeInfo.error) {
    error(lineNo, typeInfo.error);
    return;
  }

  const base = typeInfo.baseType;
  if (!base || !IDENTIFIER.test(base)) {
    error(
      lineNo,
      I18N.t(base ? 'diag.nameInvalid' : 'diag.relationSyntax'),
    );
    return;
  }
  if (!typeInfo.cardinality) {
    error(lineNo, I18N.t('diag.relationCardinality'));
    return;
  }

  relations.push({
    line: lineNo,
    target: base,
    cardinality: typeInfo.cardinality,
  });
}

function fieldKind(type) {
  if (type.cardinality) {
    return {
      owner: type.cardinality.source,
      target: type.cardinality.target,
    };
  }

  return { owner: 'many', target: 'one' };
}

function mergeCardinality(cards) {
  if (cards.some((card) => card === 'many' || card === 'zeroMany')) {
    return cards.includes('zeroMany') ? 'zeroMany' : 'many';
  }

  if (cards.some((card) => card === 'zeroOne')) {
    return 'zeroOne';
  }

  return 'one';
}

function relationLabel(fields) {
  const names = [...new Set(fields.map((field) => field.name))];
  return names.join(' / ');
}

function refTypeInfo(ref) {
  return ref.field ? ref.field.typeInfo : ref.typeInfo;
}

function createRelation(refs, entities) {
  const first = refs[0];
  const cards = new Map();
  const inferredCards = new Map();

  for (const ref of refs) {
    const typeInfo = refTypeInfo(ref);
    const kind = fieldKind(typeInfo);
    const targetMap = typeInfo.cardinality ? cards : inferredCards;

    if (!targetMap.has(ref.entity.name)) {
      targetMap.set(ref.entity.name, []);
    }
    if (!targetMap.has(ref.target)) {
      targetMap.set(ref.target, []);
    }
    targetMap.get(ref.entity.name).push(kind.owner);
    targetMap.get(ref.target).push(kind.target);
  }

  const source = first.entity.name;
  const target = first.target;
  const endpointCardinality = (name) =>
    mergeCardinality(
      cards.get(name) || inferredCards.get(name) || ['one'],
    );
  const fields = refs
    .filter((ref) => ref.field)
    .map((ref) => ({
      entity: ref.entity.name,
      name: ref.field.name,
      type: ref.field.type,
      target: ref.target,
    }));
  const isSelf = source === target;
  const selfKind = isSelf
    ? fieldKind(refTypeInfo(first))
    : { owner: 'one', target: 'one' };

  return {
    source,
    target,
    sourceCard: isSelf
      ? selfKind.owner
      : endpointCardinality(source),
    targetCard: isSelf
      ? selfKind.target
      : endpointCardinality(target),
    label: relationLabel(fields),
    fields,
    entityOrder: entities.indexOf(first.entity),
  };
}

function buildRelations(entities) {
  const refs = [];
  const entityNames = new Set(entities.map((entity) => entity.name));

  entities.forEach((entity) => {
    entity.fields.forEach((field) => {
      if (!field.typeInfo) return;

      const target = field.typeInfo.baseType;
      if (!entityNames.has(target)) return;
      if (field.typeInfo.legacyReference) return;

      field.reference = target;
      refs.push({ entity, field, target });
    });

    (entity.relations || []).forEach((relation) => {
      if (!entityNames.has(relation.target)) return;

      refs.push({
        entity,
        field: null,
        line: relation.line,
        target: relation.target,
        typeInfo: {
          baseType: relation.target,
          cardinality: relation.cardinality,
        },
      });
    });
  });

  const groups = new Map();
  const selfGroups = [];

  for (const ref of refs) {
    if (ref.entity.name === ref.target) {
      selfGroups.push({
        order: groups.size + selfGroups.length,
        key: `self:${ref.entity.name}:${ref.field ? ref.field.name : ref.line}`,
        refs: [ref],
      });
      continue;
    }

    const key = [ref.entity.name, ref.target].sort().join('\u0000');
    if (!groups.has(key)) {
      groups.set(key, {
        order: groups.size + selfGroups.length,
        key,
        refs: [],
      });
    }
    groups.get(key).refs.push(ref);
  }

  const groupedRelations = [...groups.values(), ...selfGroups].sort(
    (a, b) => a.order - b.order,
  );
  const relations = [];

  for (const group of groupedRelations) {
    const directions = new Set(group.refs.map((ref) => ref.entity.name));
    const isSelf = group.key.startsWith('self:');
    const onePerDirection =
      group.refs.length === 2 && directions.size === 2;
    const shouldMerge = !isSelf && onePerDirection;

    if (shouldMerge) {
      relations.push(createRelation(group.refs, entities));
      continue;
    }

    for (const ref of group.refs) {
      relations.push(createRelation([ref], entities));
    }
  }

  return relations.map((relation, index) => ({
    id: `rel-${index + 1}`,
    ...relation,
  }));
}

/**
 * Parses the text schema. The parser is intentionally line-oriented so error
 * messages can point to the exact source line.
 */
function parseSchema(source) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const entities = [];
  const entityNames = new Set();
  const errors = [];

  let current = null;

  const error = (line, message) => {
    errors.push({ line, message });
  };

  const finishEntity = (closeLine) => {
    if (!current) return;
    if (!current.invalid) {
      entities.push({
        name: current.name,
        line: current.line,
        closeLine: closeLine ?? null,
        fields: current.fields,
        relations: current.relations,
      });
    }
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const trimmed = lines[index].trim();

    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    if (!current) {
      if (trimmed === '}') {
        error(lineNo, I18N.t('diag.strayClosing'));
        continue;
      }

      const emptyMatch = trimmed.match(ENTITY_EMPTY);
      const openMatch = trimmed.match(ENTITY_OPEN);
      const bareMatch = trimmed.match(ENTITY_BARE);

      if (!emptyMatch && !openMatch && !bareMatch) {
        error(lineNo, I18N.t('diag.missingEntity'));
        continue;
      }

      const name = (emptyMatch || openMatch || bareMatch)[1];

      if (!IDENTIFIER.test(name)) {
        error(lineNo, I18N.t('diag.nameInvalid'));
      }

      if (entityNames.has(name)) {
        error(lineNo, I18N.t('diag.duplicateEntity', { name }));
      }

      if (bareMatch) {
        error(lineNo, I18N.t('diag.missingBrace'));
      }

      if (emptyMatch) {
        if (IDENTIFIER.test(name) && !entityNames.has(name)) {
          entityNames.add(name);
          entities.push({ name, line: lineNo, fields: [], relations: [] });
        }
        continue;
      }

      const invalid =
        !IDENTIFIER.test(name) ||
        entityNames.has(name) ||
        Boolean(bareMatch);

      if (!invalid) entityNames.add(name);

      current = {
        name,
        line: lineNo,
        fields: [],
        relations: [],
        invalid,
        fieldNames: new Set(),
      };
      continue;
    }

    if (trimmed === '}') {
      finishEntity(lineNo);
      continue;
    }

    if (/^entity\s+/u.test(trimmed)) {
      error(
        lineNo,
        I18N.t('diag.unclosed', { name: current.name }),
      );
      finishEntity();
      index -= 1;
      continue;
    }

    if (trimmed.startsWith('}')) {
      error(lineNo, I18N.t('diag.textAfterClosing'));
      continue;
    }

    if (trimmed.startsWith('{')) {
      error(lineNo, I18N.t('diag.strayOpening'));
      continue;
    }

    if (RELATION_LINE.test(trimmed)) {
      consumeRelationLine(
        cleanType(trimmed.slice('rel'.length)),
        lineNo,
        error,
        current.relations,
      );
      continue;
    }

    let fieldName = '';
    let type = '';

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex !== -1) {
      fieldName = trimmed.slice(0, colonIndex).trim();
      type = cleanType(trimmed.slice(colonIndex + 1));

      if (!type) {
        error(lineNo, I18N.t('diag.missingType'));
        continue;
      }
    } else {
      const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/u);
      fieldName = match?.[1] ?? '';
      type = cleanType(match?.[2] ?? '');
    }

    if (!IDENTIFIER.test(fieldName)) {
      error(lineNo, I18N.t('diag.fieldNameInvalid'));
      continue;
    }

    if (current.fieldNames.has(fieldName)) {
      error(
        lineNo,
        I18N.t('diag.duplicateField', {
          field: fieldName,
          entity: current.name,
        }),
      );
      continue;
    }

    const typeInfo = type ? parseTypeModifiers(type) : null;

    if (typeInfo?.error) {
      error(lineNo, typeInfo.error);
      continue;
    }

    current.fieldNames.add(fieldName);
    current.fields.push({
      name: fieldName,
      type,
      typeInfo,
      line: lineNo,
    });
  }

  if (current) {
    error(current.line, I18N.t('diag.unclosedEnd', { name: current.name }));
    finishEntity();
  }

  for (const entity of entities) {
    for (const field of entity.fields) {
      const info = field.typeInfo;
      if (!info || !entityNames.has(info.baseType)) continue;
      if (!info.legacyArray && !info.legacyOptional) continue;

      let hint = `${info.baseType}[n:1?]`;
      if (info.legacyArray && info.legacyOptional) {
        hint = `${info.baseType}[1:n?]`;
      } else if (info.legacyArray) {
        hint = `${info.baseType}[1:n]`;
      }

      info.legacyReference = true;
      error(
        field.line,
        I18N.t('diag.legacy', { type: field.type, hint }),
      );
    }
  }

  for (const entity of entities) {
    for (const relation of entity.relations || []) {
      if (entityNames.has(relation.target)) continue;
      error(
        relation.line,
        I18N.t('diag.relationUnknownTarget', {
          name: entity.name,
          target: relation.target,
        }),
      );
    }
  }

  return {
    entities,
    relations: buildRelations(entities),
    errors: errors.sort((a, b) => a.line - b.line),
  };
}

