'use strict';

const I18N = (() => {
  function fillTemplate(template, params = {}) {
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : match,
    );
  }

  const MESSAGES = {
    en: {
      title: 'ERDraft — ER diagrams from text',
      'meta.description':
        'Create ER diagrams from text and export them to .drawio. Works entirely in your browser.',
      'brand.aria': 'ERDraft — go home',
      'brand.tagline': 'text → diagram',
      'language.aria': 'Language',
      'theme.aria': 'Theme',
      'theme.option.system': 'System',
      'theme.option.light': 'Light',
      'theme.option.dark': 'Dark',
      'header.syntax': 'Syntax',
      'header.syntax.title': 'Schema syntax',
      'header.export': 'Export',
      'editor.title': 'Schema',
      'diagram.title': 'Preview',
      'editor.aria': 'Text description of the ER diagram',
      'editor.hint':
        'Relation: field type = entity or entity[1:n], or rel entity[1:n] (no field)',
      'editor.save.initial': 'Local autosave',
      'editor.save.saving': 'Saving…',
      'editor.save.saved': 'Saved locally',
      'editor.save.unavailable': 'Saving unavailable',
      'diagnostics.title': 'Schema errors',
      'status.ready': 'Ready',
      'status.empty': 'Empty',
      'export.title.invalid': 'Fix the schema errors first',
      'export.title.empty': 'Add at least one entity',
      'export.title.ready': 'Download the diagram as .drawio',
      'toast.exported': 'Downloaded erdraft-diagram.drawio',
      'toast.notReady': 'The diagram is not ready for export',
      'toast.example': 'Example inserted',
      'file.save': 'Save',
      'file.open': 'Open',
      'file.saveTitle': 'Save the schema to a file',
      'file.openTitle': 'Load a schema from a file',
      'file.saved': 'Saved {name}',
      'file.loaded': 'Loaded {name}',
      'file.loadError': "Couldn't read the file",
      'file.tooLarge': 'The file is too large',
      'diagnostic.line': 'Line {line}',
      'settings.title': 'Diagram settings',
      'settings.aria': 'Diagram settings',
      'settings.layout': 'Layout',
      'settings.layout.h': 'Horizontal',
      'settings.layout.v': 'Vertical',
      'settings.edgeStyle': 'Edge',
      'settings.edgeStyle.solid': 'Solid',
      'settings.edgeStyle.dashed': 'Dashed',
      'zoom.group': 'Diagram zoom',
      'zoom.out': 'Zoom out',
      'zoom.in': 'Zoom in',
      'zoom.fit': 'Fit',
      'zoom.fit.title': 'Fit diagram (double-click the canvas)',
      'canvas.hint': 'Wheel — zoom · double-click — fit',
      'canvas.stale': 'Showing the last valid diagram',
      'canvas.legend.aria': 'Relation legend',
      'canvas.legend.title': 'Relation',
      'canvas.legend.one': 'one',
      'canvas.legend.many': 'many',
      'canvas.legend.optional': 'optional',
      'canvas.empty.title': 'Your diagram appears here',
      'canvas.empty.text':
        'Describe entities in the editor — the preview updates automatically.',
      'canvas.empty.example': 'Insert example',
      'canvas.error.title': 'The diagram is not ready yet',
      'canvas.error.text':
        'Fix the errors in the text — the preview updates automatically.',
      'canvas.now.title': 'Nothing here yet',
      'canvas.now.text':
        'Describe your first entity in the editor — or insert a ready-made example.',
      'help.title': 'Schema syntax',
      'help.close': 'Close',
      'help.lead':
        'The whole schema is described in text. The preview and the relations are rebuilt as you type.',
      'help.code.entity': 'entity Name { … }',
      'help.rule.entity': 'An entity and its fields. Each field — on a new line.',
      'help.code.field': 'field',
      'help.code.fieldType': 'field: type',
      'help.rule.field':
        'The type is optional. A line with a colon is just more familiar.',
      'help.code.author': 'author: User',
      'help.rule.reference':
        'If the type matches an entity name, the field becomes a relation.',
      'help.rule.cardinality':
        'Explicit cardinality <code>[owner:target]</code>: <code>1</code> — one, <code>n</code> — many.',
      'help.rule.optional':
        '<code>?</code> adds zero: <code>1?</code> — 0 or 1, <code>n?</code> — zero to infinity.',
      'help.code.comment': '# comment',
      'help.rule.comment':
        'Lines that start with <code>#</code> or <code>//</code> are ignored.',
      'help.code.rel': 'rel Post[1:n]',
      'help.rule.rel':
        'Declares a relation <code>inside</code> the entity without creating a field. ' +
        'Read as <code>[owner:target]</code>, the cardinality is required.',
      'help.example.title': 'example',
      'help.example.sub': 'a relation from both sides',
      'help.example.note':
        '<code>User.posts</code> and <code>Post.author</code> describe the same one-to-many relation and will be merged.',
      'help.tip.title': 'Export',
      'help.tip.text':
        'The “Export .drawio” button downloads an editable diagram you can open in draw.io or diagrams.net.',
      'help.footer': 'Everything runs locally in your browser.',
      'help.gotIt': 'Got it',
      'noscript': 'ERDraft needs JavaScript to work.',
      'entities.one': '{count} entity',
      'entities.other': '{count} entities',
      'relations.one': '{count} relation',
      'relations.other': '{count} relations',
      'errors.one': '{count} error',
      'errors.other': '{count} errors',
      'diag.strayClosing': 'A closing brace without an entity declaration.',
      'diag.missingEntity': 'Expected an “entity Name {” declaration.',
      'diag.nameInvalid':
        'Entity names can only contain letters, digits and “_”.',
      'diag.duplicateEntity': 'Entity “{name}” is already declared.',
      'diag.missingBrace': 'An opening brace “{” is required after the entity name.',
      'diag.unclosed':
        'Entity “{name}” is not closed: add “}” before the next entity.',
      'diag.unclosedEnd': 'Entity “{name}” is not closed: add “}”.',
      'diag.textAfterClosing': 'Nothing should follow “}”.',
      'diag.strayOpening': 'Extra opening brace.',
      'diag.missingType': 'Specify a field type after “:” or remove the colon.',
      'diag.fieldNameInvalid':
        'Field names can only contain letters, digits and “_”.',
      'diag.duplicateField':
        'Field “{field}” is already declared in entity “{entity}”.',
      'diag.oneCardinality': 'Specify only one explicit cardinality.',
      'diag.invalidCardinality':
        'Cardinality must be in the form [1:1], [1:n], [n?:1] etc.',
      'diag.unbalanced':
        'Unbalanced square brackets in type “{type}”: check the “[” and “]” balance.',
      'diag.combinedLegacy':
        'Cardinality cannot be combined with “[]” or an outer “?”. Put the optionality inside the brackets: [1?:n] or [1:n?].',
      'diag.legacy': 'Legacy type “{type}”. Use “{hint}” instead.',
      'diag.relationCardinality':
        'An anonymous relation requires explicit cardinality, for example rel Post[1:n].',
      'diag.relationSyntax':
        'Expected an anonymous relation in the form rel Post[1:n].',
      'diag.relationUnknownTarget':
        'Entity “{name}” has a relation to “{target}”, which is not declared.',
      'render.entityAria': 'Entity {name}',
      'render.noFields': 'no fields',
      'render.diagramAria': 'ER diagram: {n} entities, {m} relations',
      'render.anonRelation': 'Anonymous relation: {source} ↔ {target}',
      'example.blog': '# Example: a blog',
      'example.cardinality':
        '# [source:target] is cardinality; 1?/n? allow zero.',
      'example.relation': '# An anonymous relation — a link without a field',
    },
    ru: {
      title: 'ERDraft — ER-диаграмма из текста',
      'meta.description':
        'ERDraft — создание ER-диаграмм из текста с экспортом в .drawio. Работает полностью в браузере.',
      'brand.aria': 'ERDraft — на главную',
      'brand.tagline': 'текст → диаграмма',
      'language.aria': 'Язык',
      'theme.aria': 'Тема',
      'theme.option.system': 'Системная',
      'theme.option.light': 'Светлая',
      'theme.option.dark': 'Тёмная',
      'header.syntax': 'Синтаксис',
      'header.syntax.title': 'Синтаксис схемы',
      'header.export': 'Экспорт',
      'editor.title': 'Схема',
      'diagram.title': 'Предпросмотр',
      'editor.aria': 'Текстовое описание ER-диаграммы',
      'editor.hint':
        'Связь: тип поля = entity или entity[1:n], или rel entity[1:n] (без поля)',
      'editor.save.initial': 'Локальное сохранение',
      'editor.save.saving': 'Сохраняем…',
      'editor.save.saved': 'Сохранено локально',
      'editor.save.unavailable': 'Сохранение недоступно',
      'diagnostics.title': 'Ошибки в схеме',
      'status.ready': 'Готово',
      'status.empty': 'Пусто',
      'export.title.invalid': 'Сначала исправьте ошибки в схеме',
      'export.title.empty': 'Добавьте хотя бы одну сущность',
      'export.title.ready': 'Скачать диаграмму в формате .drawio',
      'toast.exported': 'Файл erdraft-diagram.drawio скачан',
      'toast.notReady': 'Схема пока не готова к экспорту',
      'toast.example': 'Пример загружен',
      'file.save': 'Сохранить',
      'file.open': 'Открыть',
      'file.saveTitle': 'Сохранить схему в файл',
      'file.openTitle': 'Загрузить схему из файла',
      'file.saved': 'Сохранено: {name}',
      'file.loaded': 'Загружено: {name}',
      'file.loadError': 'Не удалось прочитать файл',
      'file.tooLarge': 'Файл слишком большой',
      'diagnostic.line': 'Строка {line}',
      'settings.title': 'Настройки диаграммы',
      'settings.aria': 'Настройки диаграммы',
      'settings.layout': 'Раскладка',
      'settings.layout.h': 'Горизонт.',
      'settings.layout.v': 'Вертик.',
      'settings.edgeStyle': 'Линия',
      'settings.edgeStyle.solid': 'Сплошная',
      'settings.edgeStyle.dashed': 'Пунктир',
      'zoom.group': 'Масштаб диаграммы',
      'zoom.out': 'Уменьшить',
      'zoom.in': 'Увеличить',
      'zoom.fit': 'Вписать',
      'zoom.fit.title': 'Вписать диаграмму (двойной клик по полю)',
      'canvas.hint': 'Колесо — масштаб · двойной клик — вписать',
      'canvas.stale': 'Показана последняя корректная схема',
      'canvas.legend.aria': 'Обозначения связей',
      'canvas.legend.title': 'Связь',
      'canvas.legend.one': 'один',
      'canvas.legend.many': 'много',
      'canvas.legend.optional': 'опционально',
      'canvas.empty.title': 'Здесь появится схема',
      'canvas.empty.text':
        'Опишите сущности в редакторе — предпросмотр обновится автоматически.',
      'canvas.empty.example': 'Вставить пример',
      'canvas.error.title': 'Схема пока не готова',
      'canvas.error.text':
        'Исправьте ошибки в тексте — предпросмотр обновится автоматически.',
      'canvas.now.title': 'Пока пусто',
      'canvas.now.text':
        'Опишите первую сущность в редакторе — или вставьте готовый пример.',
      'help.title': 'Синтаксис схемы',
      'help.close': 'Закрыть',
      'help.lead':
        'Схема целиком описывается текстом. Предпросмотр и связи перестраиваются на лету.',
      'help.code.entity': 'entity Имя { … }',
      'help.rule.entity': 'Сущность и её поля. Каждое поле — на новой строке.',
      'help.code.field': 'поле',
      'help.code.fieldType': 'поле: тип',
      'help.rule.field':
        'Тип необязателен. Строку с двоеточием писать привычнее.',
      'help.code.author': 'автор: User',
      'help.rule.reference':
        'Если тип совпадает с именем сущности, поле становится связью.',
      'help.rule.cardinality':
        'Явная кардинальность <code>[владелец:цель]</code>: <code>1</code> — один, <code>n</code> — много.',
      'help.rule.optional':
        '<code>?</code> добавляет ноль: <code>1?</code> — 0 или 1, <code>n?</code> — от 0 до бесконечности.',
      'help.code.comment': '# комментарий',
      'help.rule.comment':
        'Строки, начинающиеся с <code>#</code> или <code>//</code>, игнорируются.',
      'help.code.rel': 'rel Post[1:n]',
      'help.rule.rel':
        'Объявляет связь <code>внутри</code> сущности, не создавая отдельного поля. ' +
        'Читается как <code>[владелец:цель]</code>, кардинальность обязательна.',
      'help.example.title': 'пример',
      'help.example.sub': 'связь с обеих сторон',
      'help.example.note':
        '<code>User.posts</code> и <code>Post.author</code> описывают одну и ту же связь «один ко многим» и будут объединены.',
      'help.tip.title': 'Экспорт',
      'help.tip.text':
        'Кнопка «Экспорт .drawio» скачивает редактируемую диаграмму, которую можно открыть в draw.io или diagrams.net.',
      'help.footer': 'Всё работает локально в браузере.',
      'help.gotIt': 'Понятно',
      'noscript': 'Для работы ERDraft нужен JavaScript.',
      'entities.one': '{count} сущность',
      'entities.few': '{count} сущности',
      'entities.many': '{count} сущностей',
      'relations.one': '{count} связь',
      'relations.few': '{count} связи',
      'relations.many': '{count} связей',
      'errors.one': '{count} ошибка',
      'errors.few': '{count} ошибки',
      'errors.many': '{count} ошибок',
      'diag.strayClosing': 'Закрывающая скобка без объявления entity.',
      'diag.missingEntity': 'Ожидалось объявление «entity Имя {».',
      'diag.nameInvalid': 'Имя сущности может содержать только буквы, цифры и «_».',
      'diag.duplicateEntity': 'Сущность «{name}» уже объявлена.',
      'diag.missingBrace': 'После имени сущности нужна открывающая скобка «{».',
      'diag.unclosed':
        'Не закрыта сущность «{name}»: добавьте «}» перед новой entity.',
      'diag.unclosedEnd': 'Не закрыта сущность «{name}»: добавьте «}».',
      'diag.textAfterClosing': 'После «}» не должно быть текста.',
      'diag.strayOpening': 'Лишняя открывающая скобка.',
      'diag.missingType': 'После «:» укажите тип поля или уберите двоеточие.',
      'diag.fieldNameInvalid': 'Имя поля может содержать только буквы, цифры и «_».',
      'diag.duplicateField':
        'Поле «{field}» уже объявлено в сущности «{entity}».',
      'diag.oneCardinality': 'Можно указать только одну явную кардинальность.',
      'diag.invalidCardinality':
        'Кардинальность должна быть в формате [1:1], [1:n], [n?:1] и т. п.',
      'diag.unbalanced':
        'Несбалансированные скобки в типе «{type}»: проверьте баланс «[» и «]».',
      'diag.combinedLegacy':
        'Нельзя сочетать кардинальность с «[]» или внешним «?». Укажите необязательность внутри скобок: [1?:n] или [1:n?].',
      'diag.legacy': 'Устаревший тип «{type}». Используйте «{hint}».',
      'diag.relationCardinality':
        'Для анонимной связи нужна явная кардинальность, например rel Post[1:n].',
      'diag.relationSyntax':
        'Ожидалась анонимная связь в форме rel Post[1:n].',
      'diag.relationUnknownTarget':
        'У сущности «{name}» связь с необъявленной «{target}».',
      'render.entityAria': 'Сущность {name}',
      'render.noFields': 'нет полей',
      'render.diagramAria': 'ER-диаграмма: {n} сущностей, {m} связей',
      'render.anonRelation': 'Анонимная связь: {source} ↔ {target}',
      'example.blog': '# Пример: блог',
      'example.cardinality': '# [1:n] — кардинальность; 1?/n? — с нулём.',
      'example.relation': '# Анонимная связь — связь без отдельного поля',
    },
  };

  let language = 'en';

  function lookup(key) {
    const table = MESSAGES[language] || MESSAGES.en;
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    return MESSAGES.en[key];
  }

  function getLanguage() {
    return language;
  }

  function setLanguage(next) {
    if (MESSAGES[next]) language = next;
  }

  function t(key, params) {
    const template = lookup(key);
    if (template === undefined) return key;
    return fillTemplate(template, params);
  }

  function pluralCategory(count) {
    if (language === 'ru') {
      const mod10 = Math.abs(count) % 10;
      const mod100 = Math.abs(count) % 100;
      if (mod100 >= 11 && mod100 <= 14) return 'many';
      if (mod10 === 1) return 'one';
      if (mod10 >= 2 && mod10 <= 4) return 'few';
      return 'many';
    }
    return count === 1 ? 'one' : 'other';
  }

  function plural(count, base, params = {}) {
    const table = MESSAGES[language] || MESSAGES.en;
    const suffix = `.${pluralCategory(count)}`;
    let template = table[`${base}${suffix}`];
    if (template === undefined) template = MESSAGES.en[`${base}${suffix}`];
    if (template === undefined) template = MESSAGES.en[`${base}.one`];
    if (template === undefined) return String(count);
    return fillTemplate(template, { count, ...params });
  }

  return { getLanguage, setLanguage, t, plural, MESSAGES };
})();
