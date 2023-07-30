function flip(data) {
  return Object.fromEntries(
  Object
    .entries(data)
    .map(([key, value]) => [value, key])
  );
}

const countryFix = {
  'Macedonia, the former Yugoslav Republic of': 'North Macedonia',
};

export async function queryAbout() {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

  // https://apidocs.hibob.com/reference/post_people-search
  // Buggy fullName should work but doesn't
  // const res = await fetch(
  //   "https://api.hibob.com/v1/people/search",
  //   {
  //     headers: {
  //       "content-type": "application/json",
  //       Authorization: `Basic ${btoa(
  //         `SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`
  //       )}`,
  //     },
  //     method: "POST",
  //     body: JSON.stringify({
  //       "fields": [
  //         "fullName",
  //         "about.socialData.twitter",
  //         "work.title",
  //         "address.city",
  //         "address.country",
  //         "about.custom.field_1690557141686",
  //         "about.custom.field_1682954415714",
  //       ],
  //       "humanReadable": "REPLACE",
  //       "showInactive": false
  //     }),
  //   }
  // );

  const res = await fetch(
    "https://api.hibob.com/v1/people?humanReadable=true",
    {
      headers: {
        "content-type": "application/json",
        Authorization: `Basic ${btoa(
          `SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`
        )}`,
      },
      method: "GET",
    }
  );

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();

  const countriesRes = await fetch(
    "https://flagcdn.com/en/codes.json",
    {
      headers: {
        "content-type": "application/json",
      },
      method: "GET",
    }
  );

  if (countriesRes.status !== 200) {
    throw new Error(`HTTP ${countriesRes.status}: ${(await countriesRes.text()).slice(0, 500)}`);
  }
  const countries = await countriesRes.json();
  const countryToISO = flip(countries);

  return data.employees.map((employee) => {
    const country = countryFix[employee.address.country] || employee.address.country;
    return {
      name: employee.fullName,
      title: employee.work.title,
      about: employee.about?.custom?.field_1690557141686,
      location: `${employee.address.city} - ${country}`,
      locationCountry: countryToISO[country],
      twitter: employee.about?.socialData?.twitter,
      github: employee.about?.custom?.field_1682954415714,
      // ...employee,
    };
  });
}
