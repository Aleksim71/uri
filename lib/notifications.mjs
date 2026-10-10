// lib/notifications.mjs
//
// config/notifications.json decides which channels are enabled. Each
// notify handler checks its own flag - the engine knows nothing about it.

import { readJsonSafe } from './json-store.mjs';
import { configPath } from './paths.mjs';

const DEFAULT_CHANNELS = { telegram: true, email: false };

export async function enabledChannels() {
  const config = await readJsonSafe(configPath('notifications.json'), { channels: DEFAULT_CHANNELS });
  const channels = { ...DEFAULT_CHANNELS, ...(config.channels ?? {}) };
  return Object.keys(channels).filter((name) => channels[name] === true);
}
