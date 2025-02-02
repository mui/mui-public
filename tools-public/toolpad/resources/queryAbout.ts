/* eslint-disable import/prefer-default-export */
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

  const res = await fetch('https://api.hibob.com/v1/people/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Basic ${btoa(`SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`)}`,
    },
    body: JSON.stringify({
      showInactive: false,
      humanReadable: 'REPLACE',
      fields: [
        'root.displayName', // 'root.fullName', is the legal name, use the preferred name instead.
        'address.country',
        'work.custom.field_1680187492413',
        'address.city',
        'address.customColumns.column_1738498855264',
        'work.title',
        'work.tenureDurationYears',
        'about.custom.field_1682954415714',
        'about.custom.field_1690557141686',
        'about.socialData.twitter',
      ],
    }),
  });

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();

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
  countries.cz = 'Czech Republic';
  countries.us = 'US';
  countries.gb = 'UK';
  const countryToISO = flip(countries);

  return data.employees
    .sort((a, b) => parseFloat(b.work.tenureDurationYears) - parseFloat(a.work.tenureDurationYears))
    .map((employee) => {
      const country = countryFix[employee.address.country] || employee.address.country;
      const city = cityFix[employee.address.city] || employee.address.city;
      const customCity = employee.address.customColumns?.column_1738498855264;
      const teams = employee.work.custom.field_1680187492413.split(',');
      let team = teams[0];
      if (teams.includes('Core')) {
        team = 'Core';
      }
      if (teams.includes('MUI')) {
        team = 'MUI';
      }
      let location = `${customCity ?? city}, ${country}`;
      // e.g. Hong Kong
      if (city === country) {
        location = city;
      }
      return {
        name: employee.displayName,
        title: team === 'MUI' ? employee.work.title : `${employee.work.title} — ${team}`,
        location,
        locationCountry: countryToISO[country],
        about: employee.about?.custom?.field_1690557141686,
        twitter: employee.about?.socialData?.twitter?.replace('https://www.twitter.com/', ''),
        github: employee.about?.custom?.field_1682954415714?.replace('https://github.com/', ''),
        // ...employee,
      };
    });
}
