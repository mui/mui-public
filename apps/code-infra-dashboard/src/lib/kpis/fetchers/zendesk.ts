import type { KpiResult } from '../types';
import { checkHttpError, errorResult, getEnvOrError, successResult } from './utils';

const TOKEN_ENDPOINT = 'https://mui.zendesk.com/oauth/tokens';
// Request a long-lived token (Zendesk allows up to just under 2 days) so it
// comfortably outlives the hourly KPI data cache and is rarely re-minted.
const TOKEN_TTL_SECONDS = 86400;
const EXPIRY_MARGIN_MS = 60_000;

let cachedToken: { header: string; expiresAt: number } | null = null;

/**
 * Obtains (and caches) a Zendesk OAuth access token via the `client_credentials`
 * grant. Zendesk is removing API tokens as an auth method, so we exchange an
 * OAuth client id/secret for a short-lived bearer token on demand.
 *
 * Returns the full `Authorization` header value, or a `KpiResult` error if
 * authentication is not configured or the token request fails. Pass
 * `forceRefresh` to bypass the cache and mint a fresh token, e.g. after a
 * request rejected the cached one.
 */
async function getZendeskAuth(forceRefresh = false): Promise<string | KpiResult> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cachedToken.header;
  }

  const clientId = getEnvOrError('ZENDESK_CLIENT_ID');
  if (typeof clientId !== 'string') {
    return clientId;
  }

  const clientSecret = getEnvOrError('ZENDESK_CLIENT_SECRET');
  if (typeof clientSecret !== 'string') {
    return clientSecret;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'read',
      expires_in: TOKEN_TTL_SECONDS,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    // Surface Zendesk's error body (e.g. {"error":"invalid_scope",...}) so the
    // failing KPI shows why the token request was rejected, truncated in case
    // an upstream error returns a large HTML page.
    const detail = (await response.text()).slice(0, 300);
    return errorResult(`OAuth HTTP ${response.status}: ${detail}`);
  }

  const data: { access_token: string; expires_in: number } = await response.json();

  const header = `Bearer ${data.access_token}`;
  cachedToken = { header, expiresAt: Date.now() + data.expires_in * 1000 };
  return header;
}

/**
 * Performs an authenticated Zendesk API request. Because the OAuth token is
 * cached for up to 24h, it can be revoked or invalidated server-side well
 * before our cached copy lapses. If the request comes back `401`, we force a
 * fresh token and retry once so a stale token self-heals instead of leaving
 * the KPI broken until the cache expires.
 *
 * Returns the `Response`, or a `KpiResult` error if authentication is not
 * configured or the token request fails.
 */
async function zendeskFetch(url: string, forceRefresh = false): Promise<Response | KpiResult> {
  const auth = await getZendeskAuth(forceRefresh);
  if (typeof auth !== 'string') {
    return auth;
  }

  const response = await fetch(url, {
    headers: { Authorization: auth },
    next: { revalidate: 3600 },
  });

  // Retry once with a freshly minted token if the cached one was rejected.
  if (response.status === 401 && !forceRefresh) {
    return zendeskFetch(url, true);
  }

  return response;
}

export async function fetchFirstReply(): Promise<KpiResult> {
  const days = 30;
  const startTime = Math.round(Date.now() / 1000) - 3600 * 24 * days;

  // Step 1: Fetch ticket metrics
  const metricsResponse = await zendeskFetch(
    `https://mui.zendesk.com/api/v2/ticket_metrics?start_time=${startTime}`,
  );
  if (!(metricsResponse instanceof Response)) {
    return metricsResponse;
  }

  const metricsError = checkHttpError(metricsResponse, 'Metrics');
  if (metricsError) {
    return metricsError;
  }

  interface TicketMetric {
    ticket_id: number;
    reply_time_in_minutes?: { business?: number };
  }

  const metricsData: { ticket_metrics: TicketMetric[] } = await metricsResponse.json();

  if (!metricsData.ticket_metrics?.length) {
    return { value: null, metadata: 'No ticket metrics found' };
  }

  // Step 2: Fetch ticket details for tags
  const ticketIds = metricsData.ticket_metrics.map((m) => m.ticket_id).join(',');
  const ticketsResponse = await zendeskFetch(
    `https://mui.zendesk.com/api/v2/tickets/show_many?ids=${ticketIds}`,
  );
  if (!(ticketsResponse instanceof Response)) {
    return ticketsResponse;
  }

  const ticketsError = checkHttpError(ticketsResponse, 'Tickets');
  if (ticketsError) {
    return ticketsError;
  }

  interface Ticket {
    id: number;
    tags: string[];
  }

  const ticketsData: { tickets: Ticket[] } = await ticketsResponse.json();

  // Build a map of ticket ID to tags
  const tagMap: Record<number, string[]> = {};
  for (const ticket of ticketsData.tickets) {
    tagMap[ticket.id] = ticket.tags;
  }

  // Step 3: Calculate median, excluding "chasing_overdue_invoice"
  const replyTimes = metricsData.ticket_metrics
    .filter((m) => !tagMap[m.ticket_id]?.includes('chasing_overdue_invoice'))
    .map((m) => m.reply_time_in_minutes?.business)
    .filter((time): time is number => time != null)
    .sort((a, b) => a - b);

  if (replyTimes.length === 0) {
    return { value: null, metadata: 'No reply times found' };
  }

  const medianMinutes = replyTimes[Math.round(replyTimes.length / 2)];
  const medianHours = Math.round((medianMinutes / 60) * 100) / 100;

  return successResult(medianHours, 'Based on the last 100 open tickets');
}

export async function fetchSatisfactionScore(): Promise<KpiResult> {
  const days = 7 * 4; // 4 weeks
  const startTime = Math.round(Date.now() / 1000) - 3600 * 24 * days;

  const response = await zendeskFetch(
    `https://mui.zendesk.com/api/v2/satisfaction_ratings?start_time=${startTime}&score=received`,
  );
  if (!(response instanceof Response)) {
    return response;
  }

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  interface SatisfactionRating {
    ticket_id: number;
    score: string;
  }

  const data: { satisfaction_ratings: SatisfactionRating[] } = await response.json();

  if (!data.satisfaction_ratings?.length) {
    return { value: null, metadata: 'No satisfaction ratings found' };
  }

  // Keep only latest rating per ticket
  const latestRatings: Record<number, SatisfactionRating> = {};
  for (const rating of data.satisfaction_ratings) {
    latestRatings[rating.ticket_id] = rating;
  }

  const ratings = Object.values(latestRatings);
  const goodCount = ratings.filter((r) => r.score === 'good').length;
  const score = Math.round((goodCount / ratings.length) * 100);

  return successResult(score, `Number of reviews in the last 4 weeks: ${ratings.length}`);
}
