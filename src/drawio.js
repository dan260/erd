'use strict';

const CARDINALITY_TO_DRAWIO = {
  one: 'ERone',
  many: 'ERmany',
  zeroOne: 'ERzeroToOne',
  zeroMany: 'ERzeroToMany',
};

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fieldValue(field) {
  return field.type ? `${field.name}: ${field.type}` : field.name;
}

function fieldStyle(field) {
  const color = field.reference ? REFERENCE_COLOR : '#344054';
  return [
    'text',
    'html=1',
    'strokeColor=#eceef2',
    'fillColor=none',
    'align=left',
    'verticalAlign=middle',
    'spacingLeft=10',
    'spacingRight=10',
    'overflow=hidden',
    'rotatable=0',
    'points=[[0,0.5],[1,0.5]]',
    'portConstraint=eastwest',
    'fontSize=12',
    'fontFamily=Helvetica',
    `fontColor=${color}`,
  ].join(';');
}

function buildDrawioFile(layout, entities, relations) {
  const margin = 40;
  const entityIndexes = new Map(
    entities.map((entity, index) => [entity.name, index]),
  );
  const entityIds = new Map(
    entities.map((entity, index) => [entity.name, `entity-${index}`]),
  );
  const nodes = layout.nodes;

  let maxX = 0;
  let maxY = 0;
  const cells = [];

  for (const node of entities.map((entity) =>
    nodes.find((item) => item.name === entity.name),
  )) {
    if (!node) continue;
    const entity = entities[entityIndexes.get(node.name)];
    const index = entityIndexes.get(node.name);
    const palette = ENTITY_PALETTES[index % ENTITY_PALETTES.length];
    const x = node.x + margin;
    const y = node.y + margin;
    const height = node.height;

    maxX = Math.max(maxX, x + node.width);
    maxY = Math.max(maxY, y + height);

    cells.push(
      `        <mxCell id="${entityIds.get(entity.name)}" value="${escapeXml(entity.name)}" style="swimlane;html=1;fontStyle=1;align=left;verticalAlign=middle;spacingLeft=12;childLayout=stackLayout;horizontal=1;startSize=${HEADER_HEIGHT};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;rounded=1;arcSize=5;fillColor=${palette.header};swimlaneFillColor=#ffffff;strokeColor=#d7dae0;fontColor=#1d2533;fontSize=14;fontFamily=Helvetica;" vertex="1" parent="1">
          <mxGeometry x="${x}" y="${y}" width="${node.width}" height="${height}" as="geometry" />
        </mxCell>`,
    );

    entity.fields.forEach((field, fieldIndex) => {
      cells.push(
        `        <mxCell id="field-${index}-${fieldIndex}" value="${escapeXml(fieldValue(field))}" style="${fieldStyle(field)}" vertex="1" parent="${entityIds.get(entity.name)}">
          <mxGeometry y="${HEADER_HEIGHT + fieldIndex * ROW_HEIGHT}" width="${node.width}" height="${ROW_HEIGHT}" as="geometry" />
        </mxCell>`,
      );
    });
  }

  relations.forEach((relation, index) => {
    const startArrow =
      CARDINALITY_TO_DRAWIO[relation.sourceCard] || 'none';
    const endArrow =
      CARDINALITY_TO_DRAWIO[relation.targetCard] || 'none';
    const edgeStyle = [
      'edgeStyle=orthogonalEdgeStyle',
      'rounded=1',
      'orthogonalLoop=1',
      'jettySize=auto',
      'html=1',
      `startArrow=${startArrow}`,
      'startFill=0',
      `endArrow=${endArrow}`,
      'endFill=0',
      `strokeColor=${EDGE_COLOR}`,
      'strokeWidth=1.5',
      'fontSize=11',
      'fontColor=#475467',
      'labelBackgroundColor=#fbfaf7',
      'labelBorderColor=#e3e0d8',
      'fontFamily=Helvetica',
    ].join(';');

    cells.push(
      `        <mxCell id="relation-${index}" value="${escapeXml(relation.label)}" style="${edgeStyle}" edge="1" parent="1" source="${entityIds.get(relation.source)}" target="${entityIds.get(relation.target)}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>`,
    );
  });

  const pageWidth = Math.max(1169, Math.ceil(maxX + margin));
  const pageHeight = Math.max(827, Math.ceil(maxY + margin));
  const modified = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${modified}" agent="ERDraft" version="24.7.17" type="device">
  <diagram id="erdraft-diagram" name="ER Diagram">
    <mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}
