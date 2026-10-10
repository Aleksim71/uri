// lib/freelancehunt.mjs
//
// Official Freelancehunt REST API (https://apidocs.freelancehunt.com/).
// No bot login, no scraping. Token: freelancehunt.com/my/api2

const API_BASE = 'https://api.freelancehunt.com/v2';

export function freelancehuntToken() {
  const token = process.env.FREELANCEHUNT_API_TOKEN;
  if (!token) {
    const error = new Error('FREELANCEHUNT_API_TOKEN is not set (see .env.example)');
    error.code = 'FREELANCEHUNT_TOKEN_MISSING';
    throw error;
  }
  return token;
}

// Reads up to maxPages pages of a list endpoint ("projects", "threads").
export async function fetchPages({ endpoint, token, maxPages }) {
  const collected = [];
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const response = await fetch(`${API_BASE}/${endpoint}?page[number]=${pageNumber}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!response.ok) {
      const error = new Error(`Freelancehunt API (${endpoint}) returned ${response.status} ${response.statusText}`);
      error.code = 'FREELANCEHUNT_API_ERROR';
      error.details = { status: response.status, body: await response.text().catch(() => null) };
      throw error;
    }
    const body = await response.json();
    const items = Array.isArray(body.data) ? body.data : [];
    collected.push(...items);
    if (items.length === 0) break; // fewer pages than maxPages
  }
  return collected;
}
