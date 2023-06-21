import { createFunction } from "@mui/toolpad/server";

function countWomen(employees) {
  return employees.reduce((acc, item) => {
    if (item.home.legalGender === "Female") {
      return acc + 1;
    }
    return acc;
  }, 0);
}

export async function queryGender(department: string) {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

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

  let employees = data.employees;

  if (department === "Engineering") {
    employees = employees.filter(
      (employee) => employee.work.department === "Engineering"
    );
  }

  return (countWomen(employees) / employees.length) * 100;
}

export const queryGenderManagement = createFunction(async ({ parameters }) => {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

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

  let managers = data.employees.filter(
    (employee) => employee.work.isManager === "Yes"
  );

  return (countWomen(managers) / managers.length) * 100;
});
