// handlers/telegram/notify-new-messages.mjs
//
// Same outbox principle as notify-new-matches.mjs, for client messages.
// Messages are only delivered via Telegram.

import { dataPath } from '../../lib/paths.mjs';
import { readOutbox, pendingFor, markDelivered } from '../../lib/outbox.mjs';
import { enabledChannels } from '../../lib/notifications.mjs';
import { telegramCredentials, sendTelegramMessage } from '../../lib/telegram.mjs';
import { OUTBOX_FILE } from '../freelancehunt/fetch-new-messages.mjs';

const CHANNEL = 'telegram';

export function formatThreadMessage(thread) {
  return [
    `✉️ Новое сообщение от ${thread.senderName}`,
    `Тема: ${thread.subject}`,
    `Сообщений в переписке: ${thread.messagesCount ?? '—'}`,
    thread.url
  ].join('\n');
}

export async function execute() {
  const channels = await enabledChannels();
  if (!channels.includes(CHANNEL)) {
    console.log('[telegram] channel disabled in config/notifications.json, skipping');
    return { sent: 0, skipped: true };
  }

  const outboxPath = dataPath(OUTBOX_FILE);
  const pending = pendingFor(await readOutbox(outboxPath), CHANNEL);
  if (pending.length === 0) {
    console.log('[telegram] no new client messages');
    return { sent: 0 };
  }

  const { botToken, chatId } = telegramCredentials();
  let sent = 0;
  for (const thread of pending) {
    await sendTelegramMessage({ botToken, chatId, text: formatThreadMessage(thread) });
    await markDelivered(outboxPath, CHANNEL, [thread.key], [CHANNEL]);
    sent += 1;
  }

  console.log(`[telegram] sent ${sent} message notification(s)`);
  return { sent };
}
