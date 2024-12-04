/* eslint-disable import/prefer-default-export */
function flip(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [value, key]));
}

const countryFix = {
  'Macedonia, the former Yugoslav Republic of': 'North Macedonia',
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
        'address.city',
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
  const countryToISO = flip(countries);

  return data.employees
    .sort((a, b) => parseFloat(b.work.tenureDurationYears) - parseFloat(a.work.tenureDurationYears))
    .map((employee) => {
      const country = countryFix[employee.address.country] || employee.address.country;
      return {
        name: employee.displayName,
        title: employee.work.title,
        location: `${employee.address.city}, ${country}`,
        locationCountry: countryToISO[country],
        about: employee.about?.custom?.field_1690557141686,
        twitter: employee.about?.socialData?.twitter?.replace('https://www.twitter.com/', ''),
        github: employee.about?.custom?.field_1682954415714?.replace('https://github.com/', ''),
        // ...employee,
      };
    });
}
