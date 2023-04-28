import { createFunction } from "@mui/toolpad/server";

export const queryGender = createFunction(async ({ parameters }) => {
  if (!process.env.HIBOB_TOKEN) {
    throw new Error(`Env variable HIBOB_TOKEN not configured`);
  }

  const res = await fetch("https://api.hibob.com/v1/people", {
    headers: {
      "content-type": "application/json",
      'Authorization': process.env.HIBOB_TOKEN,
    },
    method: "GET",
  });

  if (res.status !== 200) {
    throw new Error(
      `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`
    );
  }
  const data = await res.json();
  return data.employees.reduce((acc, item) => {
    if (item.home.legalGender === 'Female') {
      return acc + 1;
    }
    return acc;
  }, 0) / data.employees.length;
});
