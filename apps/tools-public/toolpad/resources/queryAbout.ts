function flip(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [value, key]));
}

const countryFix = {
  'Macedonia, the former Yugoslav Republic of': 'North Macedonia',
  'United Kingdom': 'UK',
  'United States': 'US',
};

const cityFix = {
  'Greater London': 'London',
  'New York City': 'New York',
  'Islamabad Capital Territory': 'Islamabad',
};

export async function queryAbout() {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

  const peopleRes = await fetch('https://api.hibob.com/v1/people/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Basic ${btoa(`SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`)}`,
    },
    body: JSON.stringify({
      showInactive: false,
      humanReadable: 'REPLACE',
      fields: [
        'root.id',
        'root.displayName', // 'root.fullName', is the legal name, use the preferred name instead.
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
  });
  if (peopleRes.status !== 200) {
    throw new Error(`HTTP ${peopleRes.status}: ${(await peopleRes.text()).slice(0, 500)}`);
  }
  const peopleData = await peopleRes.json();

  // https://app.hibob.com/reports/company-reports/viewer/employee_data/31115981
  const workRes = await fetch(
    'https://api.hibob.com/v1/company/reports/31115981/download?format=json&humanReadable=APPEND',
    {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        Authorization: `Basic ${btoa(`SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`)}`,
      },
    },
  );
  if (workRes.status !== 200) {
    throw new Error(`HTTP ${workRes.status}: ${(await workRes.text()).slice(0, 500)}`);
  }
  let workData = await workRes.json();
  workData = workData.employees.reduce((acc, employee) => {
    acc[employee.id] = {
      old: employee.humanReadable.history.work?.title?.previousValue,
      new: employee.humanReadable.work.title,
    };
    return acc;
  }, {});

  const countriesRes = await fetch('https://flagcdn.com/en/codes.json', {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
    },
  });
  if (countriesRes.status !== 200) {
    throw new Error(`HTTP ${countriesRes.status}: ${(await countriesRes.text()).slice(0, 500)}`);
  }
  const countries = await countriesRes.json();

  // Fix country label
  countries.us = 'US';
  countries.gb = 'UK';
  const countryToISO = flip(countries);
  countryToISO['Czech Republic'] = 'cz';

  return peopleData.employees
    .sort((a, b) => parseFloat(b.work.tenureDurationYears) - parseFloat(a.work.tenureDurationYears))
    .map((employee) => {
      const country = countryFix[employee.address.country] || employee.address.country;
      const city = cityFix[employee.address.city] || employee.address.city;
      const customCity = employee.address.customColumns?.column_1738498855264;
      const teams = employee.work.custom.field_1680187492413.split(',');
      let team = teams[0];
      // Prioritize when part of multiple teams rather than picking the first one
      if (teams.includes('Core')) {
        team = 'Core';
      }
      if (teams.includes('X')) {
        team = 'X';
      }
      if (teams.includes('MUI')) {
        team = 'MUI';
      }
      let location = `${customCity ?? city}, ${country}`;
      // e.g. Hong Kong
      if (city === country) {
        location = city;
      }

      let title = employee.work.title;
      // People externally don't need to know about Acting titles. Better keep it private.
      if (title.startsWith('Acting ')) {
        title = workData[employee.id].old;
      }

      return {
        name: employee.displayName,
        title: team === 'MUI' ? title : `${title} — ${team}`,
        location,
        locationCountry: countryToISO[country],
        about: employee.about?.custom?.field_1690557141686,
        twitter: employee.about?.socialData?.twitter?.replace('https://www.twitter.com/', ''),
        github: employee.about?.custom?.field_1682954415714?.replace('https://github.com/', ''),
        // ...employee,
      };
    });
}
