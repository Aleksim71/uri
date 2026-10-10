// handlers/email/notify-new-matches.mjs
//
// Sends ONE email with every project still waiting in the outbox for the
// "email" channel. Uses SMTP via nodemailer (see .env.example).
// Project texts come from a third-party site, so they are HTML-escaped.

import nodemailer from 'nodemailer';
import { dataPath } from '../../lib/paths.mjs';
import { readOutbox, pendingFor, markDelivered } from '../../lib/outbox.mjs';
import { enabledChannels } from '../../lib/notifications.mjs';
import { OUTBOX_FILE } from '../freelancehunt/fetch-new-projects.mjs';

const CHANNEL = 'email';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url ?? '') ? url : '#';
}

export function formatHtml(projects) {
  const items = projects.map((project) => {
    const budget = project.budget ? `${project.budget.amount} ${project.budget.currency}` : 'бюджет не указан';
    const skills = project.skills?.length ? project.skills.join(', ') : '—';
    return [
      `<h3><a href="${escapeHtml(safeUrl(project.url))}">${escapeHtml(project.title)}</a></h3>`,
      `<p><b>${escapeHtml(budget)}</b> · ${escapeHtml(skills)}</p>`,
      `<p>${escapeHtml(project.description).replace(/\n/g, '<br>')}</p>`,
      '<hr>'
    ].join('\n');
  });
  return `<html><body>${items.join('\n')}</body></html>`;
}

function smtpSettings() {
  const { EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM, EMAIL_TO } = process.env;
  if (!EMAIL_SMTP_HOST || !EMAIL_SMTP_USER || !EMAIL_SMTP_PASS || !EMAIL_FROM || !EMAIL_TO) {
    const error = new Error('SMTP variables are not fully set (see .env.example)');
    error.code = 'EMAIL_CONFIG_MISSING';
    throw error;
  }
  const port = Number(EMAIL_SMTP_PORT ?? 587);
  return {
    transport: { host: EMAIL_SMTP_HOST, port, secure: port === 465, auth: { user: EMAIL_SMTP_USER, pass: EMAIL_SMTP_PASS } },
    from: EMAIL_FROM,
    to: EMAIL_TO
  };
}

export async function execute() {
  const channels = await enabledChannels();
  const outboxPath = dataPath(OUTBOX_FILE);

  if (!channels.includes(CHANNEL)) {
    console.log('[email] channel disabled in config/notifications.json, skipping');
    await markDelivered(outboxPath, CHANNEL, [], channels);
    return { sent: 0, skipped: true };
  }

  const pending = pendingFor(await readOutbox(outboxPath), CHANNEL);
  if (pending.length === 0) {
    console.log('[email] nothing new to send');
    return { sent: 0 };
  }

  const { transport, from, to } = smtpSettings();
  await nodemailer.createTransport(transport).sendMail({
    from,
    to,
    subject: `Freelancehunt: новых проектов — ${pending.length}`,
    html: formatHtml(pending)
  });
  await markDelivered(outboxPath, CHANNEL, pending.map((project) => project.key), channels);

  console.log(`[email] sent 1 email with ${pending.length} project(s)`);
  return { sent: pending.length };
}
