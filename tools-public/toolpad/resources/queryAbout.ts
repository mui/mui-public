
export async function queryAbout() {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

  // https://apidocs.hibob.com/reference/post_people-search
  // Buggy
  const res = await fetch(
    "https://api.hibob.com/v1/people/search",
    {
      headers: {
        "content-type": "application/json",
        Authorization: `Basic ${btoa(
          `SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`
        )}`,
      },
      method: "POST",
      body: JSON.stringify({
        "fields": [
          "displayName",
          "about.socialData.twitter",
          "about.socialData.github",
          "work.title",
          "address.city",
          "address.country"
        ],
        "humanReadable": "REPLACE",
        "showInactive": false
      }),
    }
  );

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();

  return data.employees.map((employee) => ({
    // name: employee.fullName,
    // title: employee.work.title,
    // location: `${employee.address.city} - ${employee.address.country}`,
    // locationCountry: employee.address.country,
    // twitter: employee.about.socialData.twitter,
    // github: employee.about.custom,
    ...employee,
  }));
}
