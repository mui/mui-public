import { type NextRequest, NextResponse } from 'next/server';

const OSS_INSIGHT_ORIGIN = 'https://api.ossinsight.io';

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug');

  if (!slug) {
    return NextResponse.json({ error: 'Missing required parameter: slug' }, { status: 400 });
  }

  const response = await fetch(`${OSS_INSIGHT_ORIGIN}/gh/repo/${slug}`, {
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `OSS Insight returned ${response.status} for ${slug}` },
      { status: response.status },
    );
  }

  const json = await response.json();
  return NextResponse.json({ id: json.data.id });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repositoryId, sql } = body;

  if (!repositoryId || !sql) {
    return NextResponse.json(
      { error: 'Missing required parameters: repositoryId and sql' },
      { status: 400 },
    );
  }

  const response = await fetch(`${OSS_INSIGHT_ORIGIN}/q/playground`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'repo', sql, id: repositoryId }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    return NextResponse.json(
      { error: `OSS Insight returned ${response.status}: ${detail}` },
      { status: response.status },
    );
  }

  const json = await response.json();
  return NextResponse.json({ rows: json.data });
}
