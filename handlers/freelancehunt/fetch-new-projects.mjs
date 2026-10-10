// handlers/freelancehunt/fetch-new-projects.mjs
//
// Polls new projects, filters them by keywords / excluded terms / budget
// (config/freelancehunt.json) and ADDS the matches to the notification
// outbox. The notify acts that follow read the outbox.
//
// Every project id is remembered in a "seen" list, so a project that was
// filtered out is not evaluated again on the next poll.

import { readJsonSafe, writeJsonAtomic } from '../../lib/json-store.mjs';
import { dataPath, configPath } from '../../lib/paths.mjs';
import { addToOutbox } from '../../lib/outbox.mjs';
import { freelancehuntToken, fetchPages } from '../../lib/freelancehunt.mjs';

export const OUTBOX_FILE = 'freelancehunt-outbox-projects.json';
const SEEN_IDS_FILE = 'freelancehunt-seen-ids.json';
const MAX_SEEN_IDS = 5000; // keep only the most recent N ids so the file does not grow forever

function haystack(project) {
  return `${project.attributes?.name ?? ''} ${project.attributes?.description ?? ''}`.toLowerCase();
}

export function matchesKeywords(project, keywords) {
  const text = haystack(project);
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function passesExcludeFilter(project, excludeKeywords) {
  if (!excludeKeywords?.enabled) return true;
  const text = haystack(project);
  return !(excludeKeywords.terms ?? []).some((term) => text.includes(term.toLowerCase()));
}

export function passesBudgetFilter(project, budgetFilter) {
  if (!budgetFilter?.enabled) return true;

  const budget = project.attributes?.budget;
  if (!budget) return true; // no budget given is not a sign of a bad project

  const eurPerUnit = budgetFilter.eurPerUnit?.[budget.currency];
  if (!eurPerUnit) return true; // unknown currency: do not filter blindly

  const amountEur = budget.amount * eurPerUnit;
  return amountEur >= (budgetFilter.minEur ?? 0) && amountEur <= (budgetFilter.maxEur ?? Infinity);
}

export function projectUrl(project) {
  // The API docs do not guarantee a direct web link field; fall back to the
  // known URL pattern.
  return project.attributes?.url
    ?? project.links?.self?.web
    ?? `https://freelancehunt.com/project/${project.id}.html`;
}

export function selectMatches(projects, config, seenIds) {
  const matches = [];
  for (const project of projects) {
    if (seenIds.has(project.id)) continue;
    seenIds.add(project.id);
    if (!matchesKeywords(project, config.keywords ?? [])) continue;
    if (!passesExcludeFilter(project, config.excludeKeywords)) continue;
    if (!passesBudgetFilter(project, config.budgetFilter)) continue;

    matches.push({
      key: String(project.id),
      id: project.id,
      title: project.attributes?.name ?? '(без названия)',
      description: project.attributes?.description ?? '',
      budget: project.attributes?.budget ?? null,
      skills: (project.attributes?.skills ?? []).map((skill) => skill.name),
      publishedAt: project.attributes?.published_at ?? null,
      url: projectUrl(project)
    });
  }
  return matches;
}

export async function execute() {
  const token = freelancehuntToken();
  const config = await readJsonSafe(configPath('freelancehunt.json'), { keywords: [], maxPagesPerPoll: 1 });
  const seenIds = new Set(await readJsonSafe(dataPath(SEEN_IDS_FILE), []));

  const projects = await fetchPages({ endpoint: 'projects', token, maxPages: config.maxPagesPerPoll ?? 1 });
  const matches = selectMatches(projects, config, seenIds);

  // Outbox first, seen-ids second: a crash in between can cause a duplicate
  // notification, but never a lost one.
  const queued = await addToOutbox(dataPath(OUTBOX_FILE), matches);
  await writeJsonAtomic(dataPath(SEEN_IDS_FILE), [...seenIds].slice(-MAX_SEEN_IDS));

  console.log(`[freelancehunt] checked ${projects.length} projects, new matches: ${matches.length}, outbox: ${queued}`);
  return { checked: projects.length, matched: matches.length, queued };
}
