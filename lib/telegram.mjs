// lib/telegram.mjs

export function telegramCredentials() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    const error = new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set (see .env.example)');
    error.code = 'TELEGRAM_CONFIG_MISSING';
    throw error;
  }
  return { botToken, chatId };
}

export async function sendTelegramMessage({ botToken, chatId, text }) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => null);
    const error = new Error(`Telegram API returned ${response.status} ${response.statusText}: ${body}`);
    error.code = 'TELEGRAM_API_ERROR';
    throw error;
  }
}
