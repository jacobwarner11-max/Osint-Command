'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getCourtSources, courtSourceUrl } = require('../lib/courts');
const { validateTarget } = require('../lib/tools');

test('court sources are curated HTTPS entries with unique ids', () => {
  const sources = getCourtSources();
  assert.ok(sources.length >= 5);
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length);
  for (const source of sources) {
    assert.equal(new URL(source.url).protocol, 'https:');
    assert.equal(courtSourceUrl(source.id), source.url);
  }
});
test('category filters restrict the directory', () => {
  assert.ok(getCourtSources('warrants').every(s => s.category === 'warrants'));
  assert.throws(() => getCourtSources('admin'), /Invalid court-source category/);
});
test('arbitrary or unsafe URLs cannot be opened through source ids', () => {
  assert.throws(() => courtSourceUrl('https://example.com'), /Unknown court source/);
  assert.throws(() => courtSourceUrl('javascript:alert(1)'), /Unknown court source/);
  assert.throws(() => courtSourceUrl({ id: 'courtlistener' }), /Unknown court source/);
});
test('court case target allows names and case numbers but rejects control text', () => {
  assert.equal(validateTarget('court', "Jane Doe"), 'Jane Doe');
  assert.equal(validateTarget('court', '2026-CR-123'), '2026-CR-123');
  assert.throws(() => validateTarget('court', 'Jane\\nDoe'), /Invalid court target/);
});
