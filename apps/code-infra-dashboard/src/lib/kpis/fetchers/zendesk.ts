import type { KpiResult } from '../types';
import { checkHttpError, getEnvOrError, successResult } from './utils';

export async function fetchFirstReply(): Promise<KpiResult> {
  const auth = getEnvOrError('ZENDESK');
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
  const auth = getEnvOrError('ZENDESK');
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
