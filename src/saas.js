import { config } from "./config.js";

const TIMEOUT_MS = 10_000;

// An error whose message is safe to show staff in Discord: either the
// dashboard's own `error` text or a fixed message from here.
export class ApiError extends Error {}

async function get(path, params = {}) {
  const url = new URL(path, config.saasBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.botApiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`[saas] ${path} failed:`, err.name);
    throw new ApiError(err.name === "TimeoutError" ? "The dashboard took too long to answer." : "Couldn't reach the dashboard.");
  }

  const body = await response.json().catch(() => null);
  if (response.ok && body) return body;

  console.error(`[saas] ${path} → ${response.status}`);
  if (response.status === 429) {
    const wait = response.headers.get("retry-after");
    throw new ApiError(`Too many requests. Try again in ${wait ?? "a few"} seconds.`);
  }
  if (response.status === 401) throw new ApiError("The bot's API key was refused. Tell an admin.");
  throw new ApiError(body?.error ?? `The dashboard answered with an error (${response.status}).`);
}

export const fetchEvents = (page) => get("/api/bot/events", { page });

export const fetchLeaderboard = ({ event, week, page, name }) =>
  get("/api/bot/leaderboard", { event, week, page, name });
