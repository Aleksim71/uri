// lib/outbox.mjs
//
// A small outbox for notifications, shared by the fetch and notify acts.
//
// Why it exists: the first version wrote "new matches" to a file that the
// next poll overwrote. If Telegram was down during a poll, those matches had
// already been marked as seen and were lost for good. Now:
//
//   - fetch acts ADD items to the outbox (never overwrite it);
//   - each channel marks an item as delivered only after a successful send;
//   - an item leaves the outbox once every enabled channel has delivered it.
//
// Delivery is therefore at-least-once per channel: after a partial failure
// the next run retries exactly the items that were not delivered yet.

import { readJsonSafe, writeJsonAtomic } from './json-store.mjs';

const MAX_OUTBOX_ITEMS = 500; // safety cap if a channel stays broken for a long time

export async function readOutbox(filePath) {
  const items = await readJsonSafe(filePath, []);
  return Array.isArray(items) ? items : [];
}

export async function addToOutbox(filePath, newItems) {
  const items = await readOutbox(filePath);
  const known = new Set(items.map((item) => item.key));
  for (const payload of newItems) {
    if (known.has(payload.key)) continue;
    known.add(payload.key);
    items.push({ ...payload, deliveredTo: [] });
  }
  await writeJsonAtomic(filePath, items.slice(-MAX_OUTBOX_ITEMS));
  return items.length;
}

export function pendingFor(items, channel) {
  return items.filter((item) => !item.deliveredTo.includes(channel));
}

// Marks the given keys as delivered for one channel, then drops items that
// every enabled channel has delivered.
export async function markDelivered(filePath, channel, keys, enabledChannels) {
  const delivered = new Set(keys);
  const items = await readOutbox(filePath);
  for (const item of items) {
    if (delivered.has(item.key) && !item.deliveredTo.includes(channel)) {
      item.deliveredTo.push(channel);
    }
  }
  const remaining = items.filter((item) => !enabledChannels.every((name) => item.deliveredTo.includes(name)));
  await writeJsonAtomic(filePath, remaining);
  return remaining.length;
}
