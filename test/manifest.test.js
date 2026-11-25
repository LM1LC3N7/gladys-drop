// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, NO_MANIFEST_DEFAULT } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics; the same version everywhere, never pinned; US only', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'semver');
  assert.equal(manifest.keywords, undefined);
  assert.deepEqual(manifest.countries, ['US']);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.3.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.name, 'gladys-drop');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-drop:${manifest.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-drop/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security', 'energy']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Chandler|sans\s+lien\s+avec\s+Chandler/i);
    assert.match(
      docs,
      /never\s+tested\s+with\s+a\s+real\s+device|jamais\s+testé\s+avec\s+un\s+vrai\s+appareil/i,
      'say it was never tested',
    );
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
});

test('the secret: no default, described as kept by Gladys; never said to be encrypted', () => {
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(
    secrets.map((f) => f.key),
    ['password'],
  );
  for (const field of secrets) {
    assert.equal(field.default, undefined);
    assert.match(field.description.en, /kept by Gladys in its database, never shown again/);
    assert.match(field.description.fr, /gardé par Gladys dans sa base, jamais réaffiché/);
  }
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'TODO.md',
    'CHANGELOG.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr|encrypt|hachage/i, `${file} says encrypted`);
  }
});

test('no capture, no sub-container', () => {
  assert.equal(manifest.network_discovery, undefined);
  assert.equal(manifest.network_wake, undefined);
  assert.equal(manifest.containers, undefined);
});

test('the configuration matches the code; every command is off by default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (NO_MANIFEST_DEFAULT.includes(key)) {
      assert.equal(fields[key].default, undefined, key);
    } else {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  for (const key of [
    'allow_water_close',
    'allow_water_open',
    'allow_bypass',
    'allow_mode_change',
  ]) {
    assert.equal(fields[key].type, 'boolean', key);
    assert.equal(fields[key].default, false, key);
    assert.equal(DEFAULT_CONFIG[key], false, key);
  }
  assert.equal(fields.broker_url.required, true);
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    assert.ok(!(section.key in DEFAULT_CONFIG), section.key);
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
  for (const field of manifest.config_schema.filter((f) => f.type === 'select')) {
    for (const option of field.options) {
      assert.equal(typeof option.label, 'object', `${field.key}: option label`);
    }
  }
});

test('the actions are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('no configuration key starts with gladys_', () => {
  for (const field of manifest.config_schema) {
    assert.doesNotMatch(field.key, /^gladys_/i, field.key);
  }
});

test('the SDK range: the latest, never pinned; the test timeout', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['@gladysassistant/integration-sdk'], /^\^0\.16\.\d+$/);
  assert.match(pkg.dependencies.mqtt, /^\^5\.\d+\.\d+$/);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
});
