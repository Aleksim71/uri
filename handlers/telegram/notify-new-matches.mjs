// handlers/telegram/notify-new-matches.mjs
//
// Sends one Telegram message per project that is still waiting in the
// outbox for the "telegram" channel. Each project is marked as delivered
// right after its own successful send, so if Telegram fails halfway the
// next run continues with the remaining projects.
//
// Message texts are in Russian on purpose: Freelancehunt is a
// Russian/Ukrainian-speaking marketplace and the notifications are for me.

import { dataPath } from '../../lib/paths.mjs';
import { readOutbox, pendingFor, markDelivered } from '../../lib/outbox.mjs';
import { enabledChannels } from '../../lib/notifications.mjs';
import { telegramCredentials, sendTelegramMessage } from '../../lib/telegram.mjs';
import { OUTBOX_FILE } from '../freelancehunt/fetch-new-projects.mjs';

const CHANNEL = 'telegram';
const TELEGRAM_MESSAGE_LIMIT = 4096;
const DESCRIPTION_PREVIEW_LENGTH = 600; // leaves room for the other fields

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text ?? '';
  return `${text.slice(0, maxLength).trim()}…`;
}

export function formatProjectMessage(project) {
  const budget = project.budget ? `${project.budget.amount} ${project.budget.currency}` : 'бюджет не указан';
  const skills = project.skills?.length ? project.skills.join(', ') : '—';
  const message = [
    `🆕 ${project.title}`,
    `💰 ${budget}`,
    `🏷️ ${skills}`,
    '',
    truncate(project.description, DESCRIPTION_PREVIEW_LENGTH),
    '',
    project.url
  ].join('\n');
  return truncate(message, TELEGRAM_MESSAGE_LIMIT);
}

export async function execute() {
  const channels = await enabledChannels();
  const outboxPath = dataPath(OUTBOX_FILE);

  if (!channels.includes(CHANNEL)) {
    console.log('[telegram] channel disabled in config/notifications.json, skipping');
    await markDelivered(outboxPath, CHANNEL, [], channels); // still prune items other channels finished
    return { sent: 0, skipped: true };
  }

  const pending = pendingFor(await readOutbox(outboxPath), CHANNEL);
  if (pending.length === 0) {
    console.log('[telegram] nothing new to send');
    return { sent: 0 };
  }

  const { botToken, chatId } = telegramCredentials();
  let sent = 0;
  for (const project of pending) {
    await sendTelegramMessage({ botToken, chatId, text: formatProjectMessage(project) });
    await markDelivered(outboxPath, CHANNEL, [project.key], channels);
    sent += 1;
  }

  console.log(`[telegram] sent ${sent} project notification(s)`);
  return { sent };
}
