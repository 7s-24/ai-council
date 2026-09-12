import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { root } from './lib.mjs';

function loadTranslations() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8'), context);
  return context.window.AICouncilI18n;
}

test('Chinese and English dictionaries expose the same non-empty keys', () => {
  const translations = loadTranslations();
  assert.deepEqual(Object.keys(translations.en).sort(), Object.keys(translations.zh).sort());
  Object.values(translations).forEach((dictionary) => {
    Object.values(dictionary).forEach((value) => assert.ok(String(value).trim()));
  });
});

test('every static translation marker resolves in both languages', () => {
  const translations = loadTranslations();
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-aria|-title|-placeholder)?="([^"]+)"/g)].map((match) => match[1]);
  keys.forEach((key) => {
    assert.ok(translations.zh[key], `Missing Chinese translation: ${key}`);
    assert.ok(translations.en[key], `Missing English translation: ${key}`);
  });
});
