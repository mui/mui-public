function countWomen(employees) {
  return employees.reduce((acc, item) => {
    if (item.home.legalGender === 'Female') {
      return acc + 1;
    }
    return acc;
  }, 0);
}

export async function queryGender(department: string) {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

  const res = await fetch('https://api.hibob.com/v1/profiles', {
    headers: {
      'content-type': 'application/json',
      Authorization: `Basic ${btoa(`SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`)}`,
    },
    method: 'GET',
  });

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();

  let employees = data.employees;

  if (department) {
    employees = employees.filter((employee) => employee.work.department === department);
  }

  return (countWomen(employees) / employees.length) * 100;
}

export async function queryGenderManagement() {
  if (!process.env.HIBOB_TOKEN_READ_STANDARD) {
    throw new Error(`Env variable HIBOB_TOKEN_READ_STANDARD not configured`);
  }

  const res = await fetch('https://api.hibob.com/v1/profiles', {
    headers: {
      'content-type': 'application/json',
      Authorization: `Basic ${btoa(`SERVICE-5772:${process.env.HIBOB_TOKEN_READ_STANDARD}`)}`,
    },
    method: 'GET',
  });

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();

  const managers = data.employees.filter((employee) => employee.work.isManager === true);

  return (countWomen(managers) / managers.length) * 100;
}
