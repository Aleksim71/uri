import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesKeywords, passesExcludeFilter, passesBudgetFilter, selectMatches
} from '../handlers/freelancehunt/fetch-new-projects.mjs';
import { selectNewMessages } from '../handlers/freelancehunt/fetch-new-messages.mjs';
import { formatHtml, escapeHtml } from '../handlers/email/notify-new-matches.mjs';

const project = (id, name, description = '', budget = null) => ({ id, attributes: { name, description, budget } });

test('keywords match title or description, case-insensitive', () => {
  assert.equal(matchesKeywords(project(1, 'Telegram BOT на Node.js'), ['node.js']), true);
  assert.equal(matchesKeywords(project(2, 'Логотип', 'нужен парсер цен'), ['парсер']), true);
  assert.equal(matchesKeywords(project(3, 'Логотип'), ['парсер']), false);
});

test('exclude terms win over keywords', () => {
  const filter = { enabled: true, terms: ['planfix'] };
  assert.equal(passesExcludeFilter(project(1, 'Скрипт для Planfix'), filter), false);
  assert.equal(passesExcludeFilter(project(1, 'Скрипт для Planfix'), { ...filter, enabled: false }), true);
});

test('budget filter converts to EUR and keeps unknown cases', () => {
  const filter = { enabled: true, minEur: 5, maxEur: 150, eurPerUnit: { UAH: 0.02 } };
  assert.equal(passesBudgetFilter(project(1, 'x', '', { amount: 1000, currency: 'UAH' }), filter), true); // 20 EUR
  assert.equal(passesBudgetFilter(project(2, 'x', '', { amount: 100, currency: 'UAH' }), filter), false); // 2 EUR
  assert.equal(passesBudgetFilter(project(3, 'x', '', { amount: 99999, currency: 'UAH' }), filter), false);
  assert.equal(passesBudgetFilter(project(4, 'x', '', null), filter), true);
  assert.equal(passesBudgetFilter(project(5, 'x', '', { amount: 1, currency: 'XYZ' }), filter), true);
});

test('selectMatches remembers every id, including filtered-out ones', () => {
  const seen = new Set([1]);
  const matches = selectMatches(
    [project(1, 'node.js old'), project(2, 'node.js new'), project(3, 'logo')],
    { keywords: ['node.js'] },
    seen
  );
  assert.deepEqual(matches.map((m) => m.key), ['2']);
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('client messages: unread only, once per new post in a thread', () => {
  const thread = (id, lastPost, unread = true) => ({
    id, attributes: { is_unread: unread, last_post_at: lastPost, subject: 's', participants: { from: { login: 'client' } } }
  });
  const seen = new Set();
  assert.equal(selectNewMessages([thread(1, 'a'), thread(2, 'a', false)], seen).length, 1);
  assert.equal(selectNewMessages([thread(1, 'a')], seen).length, 0);
  assert.equal(selectNewMessages([thread(1, 'b')], seen).length, 1);
});

test('email HTML escapes third-party text and rejects non-http links', () => {
  const html = formatHtml([{
    title: '<script>alert(1)</script>',
    description: 'a & b\nnext',
    url: 'javascript:alert(1)',
    budget: null,
    skills: []
  }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b<br>next'));
  assert.ok(html.includes('href="#"'));
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});
