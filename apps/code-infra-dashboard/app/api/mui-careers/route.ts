import { NextResponse } from 'next/server';
import { z } from 'zod/v4';

interface CareerJob {
  id: string;
  title: string;
  category: string;
  description: string;
  applicationUrl: string;
}

const jobBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      department: z.string().optional(),
      isListed: z.boolean(),
      descriptionHtml: z.string(),
      applyUrl: z.url(),
    }),
  ),
});

export async function GET() {
  try {
    const response = await fetch('https://api.ashbyhq.com/posting-api/job-board/MUI', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Ashby HTTP ${response.status}`);
    }

    const { jobs } = jobBoardSchema.parse(await response.json());

    const careerJobs: CareerJob[] = jobs
      .filter((job) => job.isListed)
      .map((job) => ({
        id: job.id,
        title: job.title,
        category: job.department || 'Other',
        description: job.descriptionHtml,
        applicationUrl: job.applyUrl,
      }));

    return NextResponse.json({ data: careerJobs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch published jobs from Ashby' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
