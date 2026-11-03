'use strict';

const SETTINGS_KEY = 'erdraft.settings.v1';
const LAYOUTS = ['horizontal', 'vertical'];
const EDGE_STYLES = ['solid', 'dashed'];

const ERDRAFT_SETTINGS = { layout: 'horizontal', edgeStyle: 'solid' };

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.layout && LAYOUTS.includes(parsed.layout)) {
      ERDRAFT_SETTINGS.layout = parsed.layout;
    }
    if (parsed.edgeStyle && EDGE_STYLES.includes(parsed.edgeStyle)) {
      ERDRAFT_SETTINGS.edgeStyle = parsed.edgeStyle;
    }
  } catch { /* localStorage unavailable */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(ERDRAFT_SETTINGS));
  } catch { /* localStorage unavailable */ }
}

function setSetting(key, value) {
  const allowed = key === 'layout' ? LAYOUTS : EDGE_STYLES;
  if (!allowed.includes(value)) return;
  ERDRAFT_SETTINGS[key] = value;
  saveSettings();
}

readSettings();
