import type { KpiResult } from '../types';
import { errorResult, getEnvOrError, successResult } from './utils';

interface HiBobEmployee {
  home: {
    legalGender?: string;
  };
  work: {
    department?: string;
    isManager?: boolean;
  };
}

function countWomen(employees: HiBobEmployee[]): number {
  return employees.reduce((acc, employee) => {
    if (employee.home.legalGender === 'Female') {
      return acc + 1;
    }
    return acc;
  }, 0);
}

async function fetchEmployees(): Promise<HiBobEmployee[] | KpiResult> {
  const token = getEnvOrError('HIBOB_TOKEN_READ_STANDARD');
  if (typeof token !== 'string') {
    return token;
  }

  const response = await fetch('https://api.hibob.com/v1/profiles', {
    headers: {
      'content-type': 'application/json',
      Authorization: `Basic ${Buffer.from(`SERVICE-5772:${token}`).toString('base64')}`,
    },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    return errorResult('Failed to fetch employees');
  }

  const data: { employees: HiBobEmployee[] } = await response.json();
  return data.employees;
}

export async function fetchGender(department?: string): Promise<KpiResult> {
  const result = await fetchEmployees();

  if (!Array.isArray(result)) {
    return result;
  }

  let employees = result;

  if (department) {
    employees = employees.filter((employee) => employee.work.department === department);
  }

  if (employees.length === 0) {
    return { value: null, metadata: 'No employees found' };
  }

  const percentage = Math.round((countWomen(employees) / employees.length) * 1000) / 10;

  return successResult(percentage);
}

export async function fetchGenderManagement(): Promise<KpiResult> {
  const result = await fetchEmployees();

  if (!Array.isArray(result)) {
    return result;
  }

  const managers = result.filter((employee) => employee.work.isManager === true);

  if (managers.length === 0) {
    return { value: null, metadata: 'No managers found' };
  }

  const percentage = Math.round((countWomen(managers) / managers.length) * 1000) / 10;

  return successResult(percentage);
}
