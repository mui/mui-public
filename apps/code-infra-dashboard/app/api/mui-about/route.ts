import { NextResponse } from 'next/server';

const COUNTRY_FIX: Record<string, string> = {
  'Macedonia, the former Yugoslav Republic of': 'North Macedonia',
  'United Kingdom': 'UK',
  'United States': 'US',
};

const CITY_FIX: Record<string, string> = {
  'Greater London': 'London',
  'New York City': 'New York',
  'Islamabad Capital Territory': 'Islamabad',
};

interface HibobEmployee {
  id: string;
  displayName: string;
  address: {
    country: string;
    city: string;
    customColumns?: { column_1738498855264?: string };
  };
  work: {
    title: string;
    tenureDurationYears: string;
    custom: { field_1680187492413: string };
  };
  about?: {
    custom?: {
      field_1682954415714?: string;
      field_1690557141686?: string;
    };
    socialData?: { twitter?: string };
  };
}

interface HibobReportEmployee {
  id: string;
  humanReadable: {
    work: { title: string };
    history: { work?: { title?: { previousValue?: string } } };
  };
}

interface AboutPerson {
  name: string;
  title: string;
  about: string | null;
  location: string;
  locationCountry: string | null;
  github: string | null;
  twitter: string | null;
}

async function hibobFetch(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`https://api.hibob.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Basic ${btoa(`SERVICE-5772:${token}`)}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`HiBob HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

function stripHandle(url: string | undefined, prefix: string): string | null {
  if (!url) {
    return null;
  }
  return url.replace(prefix, '');
}

export async function GET() {
  const token = process.env.HIBOB_TOKEN_READ_STANDARD;
  if (!token) {
    return NextResponse.json(
      { error: 'Env variable HIBOB_TOKEN_READ_STANDARD not configured' },
      { status: 500 },
    );
  }

  const [peopleData, workReport, countries] = await Promise.all([
    hibobFetch('/v1/people/search', token, {
      method: 'POST',
      body: JSON.stringify({
        showInactive: false,
        humanReadable: 'REPLACE',
        fields: [
          'root.id',
          'root.displayName',
          'address.country',
          'address.city',
          'address.customColumns.column_1738498855264',
          'work.custom.field_1680187492413',
          'work.title',
          'work.tenureDurationYears',
          'about.custom.field_1682954415714',
          'about.custom.field_1690557141686',
          'about.socialData.twitter',
        ],
      }),
    }) as Promise<{ employees: HibobEmployee[] }>,
    hibobFetch(
      '/v1/company/reports/31115981/download?format=json&humanReadable=APPEND',
      token,
    ) as Promise<{ employees: HibobReportEmployee[] }>,
    fetch('https://flagcdn.com/en/codes.json').then((res) => {
      if (!res.ok) {
        throw new Error(`flagcdn HTTP ${res.status}`);
      }
      return res.json() as Promise<Record<string, string>>;
    }),
  ]);

  const previousTitleById = new Map<string, string | undefined>(
    workReport.employees.map((employee) => [
      employee.id,
      employee.humanReadable.history.work?.title?.previousValue,
    ]),
  );

  const countryToISO: Record<string, string> = Object.fromEntries(
    Object.entries(countries).map(([iso, name]) => [name, iso]),
  );
  countryToISO['Czech Republic'] = 'cz';
  countryToISO.US = 'us';
  countryToISO.UK = 'gb';

  const people: AboutPerson[] = peopleData.employees
    .sort(
      (a, b) =>
        parseFloat(b.work.tenureDurationYears) - parseFloat(a.work.tenureDurationYears),
    )
    .map((employee) => {
      const country = COUNTRY_FIX[employee.address.country] ?? employee.address.country;
      const city = CITY_FIX[employee.address.city] ?? employee.address.city;
      const customCity = employee.address.customColumns?.column_1738498855264;
      const teams = employee.work.custom.field_1680187492413.split(',');
      let team = teams[0];
      if (teams.includes('Core')) {
        team = 'Core';
      }
      if (teams.includes('X')) {
        team = 'X';
      }
      if (teams.includes('MUI')) {
        team = 'MUI';
      }
      const location = city === country ? city : `${customCity ?? city}, ${country}`;

      let title = employee.work.title;
      if (title.startsWith('Acting ')) {
        title = previousTitleById.get(employee.id) ?? title;
      }

      return {
        name: employee.displayName,
        title: team === 'MUI' ? title : `${title} — ${team}`,
        about: employee.about?.custom?.field_1690557141686 ?? null,
        location,
        locationCountry: countryToISO[country] ?? null,
        github: stripHandle(employee.about?.custom?.field_1682954415714, 'https://github.com/'),
        twitter: stripHandle(
          employee.about?.socialData?.twitter,
          'https://www.twitter.com/',
        ),
      };
    });

  return NextResponse.json({ people });
}
