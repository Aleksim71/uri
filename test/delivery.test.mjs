// End-to-end test of the Freelancehunt poll scenario with a mocked network.
//
// Regression test for the original bug: a project was marked as "seen"
// before the notification was sent, and the next poll overwrote the list of
// new matches - so a Telegram outage silently lost notifications.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../engine/interpreter.mjs';
import { makeTempDir } from './helpers.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLL = JSON.parse(await fs.readFile(path.join(CODE_ROOT, 'scenarios/freelancehunt/poll.json'), 'utf8'));

let sentToTelegram;
let telegramDown;
let projectsOnSite;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  process.env.URI_DATA_DIR = await makeTempDir();
  process.env.URI_CONFIG_DIR = await makeTempDir('uri-config-');
  await fs.writeFile(path.join(process.env.URI_CONFIG_DIR, 'notifications.json'),
    JSON.stringify({ channels: { telegram: true, email: false } }));
  await fs.writeFile(path.join(process.env.URI_CONFIG_DIR, 'freelancehunt.json'),
    JSON.stringify({ keywords: ['node'], maxPagesPerPoll: 1 }));
  Object.assign(process.env, { FREELANCEHUNT_API_TOKEN: 'test', TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_CHAT_ID: '1' });

  sentToTelegram = [];
  telegramDown = () => false;
  projectsOnSite = [];

  globalThis.fetch = async (url, options) => {
    if (url.startsWith('https://api.freelancehunt.com/')) {
      const page = new URL(url).searchParams.get('page[number]');
      return Response.json({ data: page === '1' ? projectsOnSite : [] });
    }
    if (url.startsWith('https://api.telegram.org/')) {
      if (telegramDown()) throw new TypeError('fetch failed');
      sentToTelegram.push(JSON.parse(options.body).text.split('\n')[0]);
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected request ${url}`);
  };
});

afterEach(() => { globalThis.fetch = originalFetch; });

const project = (id, name) => ({ id, attributes: { name, description: '' } });

test('a Telegram outage does not lose notifications', async () => {
  const uri = new Interpreter({ codeRoot: CODE_ROOT });
  projectsOnSite = [project(1, 'node one'), project(2, 'node two'), project(3, 'logo design')];

  // Poll 1: Telegram goes down after the first message.
  telegramDown = () => sentToTelegram.length >= 1;
  const first = await uri.run({ ...POLL, onError: undefined });
  assert.equal(first.outcome, 'failed');
  assert.deepEqual(sentToTelegram, ['🆕 node one']);

  // Poll 2: Telegram is back, a new project appeared. The undelivered one
  // from poll 1 is sent too, nothing is sent twice.
  telegramDown = () => false;
  projectsOnSite = [...projectsOnSite, project(4, 'node four')];
  const second = await uri.run({ ...POLL, onError: undefined });
  assert.equal(second.outcome, 'completed');
  assert.deepEqual(sentToTelegram, ['🆕 node one', '🆕 node two', '🆕 node four']);

  // Poll 3: nothing new, nothing sent, outbox is empty.
  await uri.run({ ...POLL, onError: undefined });
  assert.equal(sentToTelegram.length, 3);
  const outbox = JSON.parse(await fs.readFile(
    path.join(process.env.URI_DATA_DIR, 'freelancehunt-outbox-projects.json'), 'utf8'));
  assert.deepEqual(outbox, []);
});

test('items wait for every enabled channel before leaving the outbox', async () => {
  await fs.writeFile(path.join(process.env.URI_CONFIG_DIR, 'notifications.json'),
    JSON.stringify({ channels: { telegram: true, email: true } }));
  const uri = new Interpreter({ codeRoot: CODE_ROOT });
  projectsOnSite = [project(1, 'node one')];

  // Email has no SMTP settings -> the email act fails after Telegram succeeded.
  const result = await uri.run({ ...POLL, onError: undefined });
  assert.equal(result.reasonCode, 'EMAIL_CONFIG_MISSING');

  const outbox = JSON.parse(await fs.readFile(
    path.join(process.env.URI_DATA_DIR, 'freelancehunt-outbox-projects.json'), 'utf8'));
  assert.deepEqual(outbox.map((item) => item.deliveredTo), [['telegram']]);

  // Next poll: Telegram does not resend it.
  await uri.run({ ...POLL, onError: undefined });
  assert.deepEqual(sentToTelegram, ['🆕 node one']);
});
