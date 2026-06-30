import type { KpiResult } from '../types';
import { checkHttpError, errorResult, successResult } from './utils';

const TOKEN_ENDPOINT = 'https://mui.zendesk.com/oauth/tokens';
// Request a 1 hour token (Zendesk allows 300s–172800s) and refresh slightly early.
const TOKEN_TTL_SECONDS = 3600;
const EXPIRY_MARGIN_MS = 60_000;

let cachedToken: { header: string; expiresAt: number } | null = null;

/**
 * Obtains (and caches) a Zendesk OAuth access token via the `client_credentials`
 * grant. Zendesk is removing API tokens as an auth method, so we exchange an
 * OAuth client id/secret for a short-lived bearer token on demand.
 *
 * Returns the full `Authorization` header value, or a `KpiResult` error if
 * authentication is not configured or the token request fails.
 */
async function getZendeskAuth(): Promise<string | KpiResult> {
  if (cachedToken && cachedToken.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cachedToken.header;
  }

  const clientId = process.env.ZENDESK_CLIENT_ID;
  const clientSecret = process.env.ZENDESK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorResult('ZENDESK_CLIENT_ID / ZENDESK_CLIENT_SECRET not configured');
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

  const tokenError = checkHttpError(response, 'OAuth');
  if (tokenError) {
    return tokenError;
  }

  const data: { access_token: string; expires_in: number } = await response.json();

  const header = `Bearer ${data.access_token}`;
  cachedToken = { header, expiresAt: Date.now() + data.expires_in * 1000 };
  return header;
}

export async function fetchFirstReply(): Promise<KpiResult> {
  const auth = await getZendeskAuth();
  if (typeof auth !== 'string') {
    return auth;
  }

  const days = 30;
  const startTime = Math.round(Date.now() / 1000) - 3600 * 24 * days;

  // Step 1: Fetch ticket metrics
  const metricsResponse = await fetch(
    `https://mui.zendesk.com/api/v2/ticket_metrics?start_time=${startTime}`,
    {
      headers: { Authorization: auth },
      next: { revalidate: 3600 },
    },
  );

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
  const ticketsResponse = await fetch(
    `https://mui.zendesk.com/api/v2/tickets/show_many?ids=${ticketIds}`,
    {
      headers: { Authorization: auth },
      next: { revalidate: 3600 },
    },
  );

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
  const auth = await getZendeskAuth();
  if (typeof auth !== 'string') {
    return auth;
  }

  const days = 7 * 4; // 4 weeks
  const startTime = Math.round(Date.now() / 1000) - 3600 * 24 * days;

  const response = await fetch(
    `https://mui.zendesk.com/api/v2/satisfaction_ratings?start_time=${startTime}&score=received`,
    {
      headers: { Authorization: auth },
      next: { revalidate: 3600 },
    },
  );

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
