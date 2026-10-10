// handlers/freelancehunt/fetch-new-messages.mjs
//
// Polls the Threads API (conversations with clients) and adds unread
// messages to the outbox. Dedupe key is (thread id, last_post_at): a thread
// does not disappear after reading, it gets a new last_post_at with every
// new message - so this notifies once per new message, not once per thread.
//
// Note: the Threads API returns thread metadata, not the message body, so
// the notification shows subject, sender and message count.

import { readJsonSafe, writeJsonAtomic } from '../../lib/json-store.mjs';
import { dataPath, configPath } from '../../lib/paths.mjs';
import { addToOutbox } from '../../lib/outbox.mjs';
import { freelancehuntToken, fetchPages } from '../../lib/freelancehunt.mjs';

export const OUTBOX_FILE = 'freelancehunt-outbox-messages.json';
const SEEN_FILE = 'freelancehunt-seen-messages.json';
const MAX_SEEN = 5000;

function threadUrl(thread) {
  return thread.links?.self?.web ?? `https://freelancehunt.com/mailbox/read/thread/${thread.id}`;
}

export function selectNewMessages(threads, seen) {
  const result = [];
  for (const thread of threads) {
    const attrs = thread.attributes ?? {};
    if (!attrs.is_unread) continue;

    const key = `${thread.id}:${attrs.last_post_at}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sender = attrs.participants?.from;
    const senderName = sender
      ? `${sender.first_name ?? ''} ${sender.last_name ?? ''}`.trim() || sender.login
      : 'неизвестно';

    result.push({
      key,
      threadId: thread.id,
      subject: attrs.subject ?? '(без темы)',
      senderName,
      messagesCount: attrs.messages_count ?? null,
      lastPostAt: attrs.last_post_at ?? null,
      url: threadUrl(thread)
    });
  }
  return result;
}

export async function execute() {
  const token = freelancehuntToken();
  const config = await readJsonSafe(configPath('freelancehunt.json'), {});
  const seen = new Set(await readJsonSafe(dataPath(SEEN_FILE), []));

  const threads = await fetchPages({ endpoint: 'threads', token, maxPages: config.maxMessagePagesPerPoll ?? 1 });
  const messages = selectNewMessages(threads, seen);

  const queued = await addToOutbox(dataPath(OUTBOX_FILE), messages);
  await writeJsonAtomic(dataPath(SEEN_FILE), [...seen].slice(-MAX_SEEN));

  console.log(`[freelancehunt] checked ${threads.length} threads, new messages: ${messages.length}, outbox: ${queued}`);
  return { checked: threads.length, matched: messages.length, queued };
}
