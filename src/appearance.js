'use strict';

const THEME_KEY = 'erdraft.theme.v1';
const THEME_PREFERENCES = ['system', 'light', 'dark'];
const THEME_MEDIA = window.matchMedia('(prefers-color-scheme: dark)');

function readThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && THEME_PREFERENCES.includes(stored)) return stored;
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function resolveThemePreference(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return THEME_MEDIA.matches ? 'dark' : 'light';
}

function updateThemeMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim();
  if (background) meta.setAttribute('content', background);
}

function onSystemThemeChange() {
  if (themePreference === 'system') {
    applyThemePreference('system');
  }
}

let themePreference = readThemePreference();

function applyThemePreference(preference) {
  if (!THEME_PREFERENCES.includes(preference)) preference = 'system';
  themePreference = preference;

  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // localStorage unavailable
  }

  const theme = resolveThemePreference(preference);
  document.documentElement.dataset.theme = theme;
  updateThemeMeta();

  const select = document.querySelector('#themeSelect');
  if (select && select.value !== preference) select.value = preference;
}

if (typeof THEME_MEDIA.addEventListener === 'function') {
  THEME_MEDIA.addEventListener('change', onSystemThemeChange);
}

applyThemePreference(readThemePreference());
