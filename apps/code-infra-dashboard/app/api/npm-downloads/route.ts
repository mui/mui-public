import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const packages = searchParams.getAll('package');
  const from = searchParams.get('from');
  const until = searchParams.get('until');

  if (packages.length === 0 || !from || !until) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  const url = new URL('https://npm-stat.com/api/download-counts');
  for (const pkg of packages) {
    url.searchParams.append('package', pkg);
  }
  url.searchParams.set('from', from);
  url.searchParams.set('until', until);

  const response = await fetch(url.toString());

  if (!response.ok) {
    return NextResponse.json(
      { error: `npm-stat.com returned ${response.status}` },
      { status: response.status },
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
