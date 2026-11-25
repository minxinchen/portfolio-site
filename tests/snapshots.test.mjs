import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditPage } from '../tools/wp-search-lab/src/core.js';

// Regression snapshots modelled on real WordPress output. Each guards a false positive found when the
// engine was run against a real site (wordpress.org/news) on 2026-11-25.
const load = name => readFileSync(new URL('../tools/wp-search-lab/tests/fixtures/' + name, import.meta.url), 'utf8');
const run = (name, url) => auditPage({ url, html: load(name), sourceKind: 'snapshot', context: { product: false, multilingual: false } });
const status = (audit, id) => audit.results.find(r => r.ruleId === id).status;

test('footer widget headings do not create fake skipped-level warnings or inflate the outline', () => {
  const a = run('wp-blog-listing.html', 'https://news.example.org/');
  assert.equal(status(a, 'heading-structure'), 'PASS');
  assert.deepEqual(a.preview.outline.map(h => h.text), ['News', 'Latest posts', 'Release 7.2', 'Community update', 'Meetup recap']);
});

test('home / archive pages are not reported as thin content or missing author signals', () => {
  const a = run('wp-blog-listing.html', 'https://news.example.org/');
  assert.equal(a.preview.pageType, 'listing');
  assert.equal(status(a, 'readability'), 'PASS');
  assert.equal(status(a, 'eeat-signals'), 'NOT_APPLICABLE');
});

test('an article that only mentions plugin names in its text is not flagged as a plugin conflict', () => {
  const a = run('wp-seo-tutorial.html', 'https://blog.example.org/yoast-vs-rank-math/');
  assert.equal(a.preview.pageType, 'content');
  assert.deepEqual(a.preview.wpStack.seoPlugins, []);
  assert.equal(status(a, 'wp-stack'), 'UNKNOWN');
});

test('two SEO plugins that really emit output are detected as a conflict', () => {
  const a = run('wp-double-seo.html', 'https://shop.example.org/about/');
  assert.deepEqual(a.preview.wpStack.seoPlugins, ['Yoast SEO', 'Rank Math']);
  assert.equal(status(a, 'wp-stack'), 'FAIL');
  assert.equal(status(a, 'canonical'), 'FAIL');
});
