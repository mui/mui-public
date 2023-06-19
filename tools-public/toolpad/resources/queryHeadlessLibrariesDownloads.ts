export const formatDatePart = (datePart) => {
  return `${datePart < 10 ? '0' : ''}${datePart}`;
};

export const getDateString = (date: Date) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}-${month < 10 ? '0' : ''}${month}-${
    day < 10 ? '0' : ''
  }${date.getDate()}`;
};

export const getPackages = (inData) => {
  const packages: string[] = [];
  Object.keys(inData ?? {}).forEach((packageName) => {
    packages.push(packageName);
  });
  return packages;
};

export const getMonthKey = (date: string) => {
  return date.slice(0, -2) + '01';
};

export const prepareData = (inData) => {
  const date = new Date(2022, 6, 1, 0, 0, 0, 0);
  const today = new Date();
  const packages = getPackages(inData);

  const monthsData = {};

  while (date < today) {
    monthsData[getDateString(date)] = {};
    packages.forEach((packageName) => {
      monthsData[getDateString(date)][packageName] = 0;
    });
    date.setMonth(date.getMonth() + 1);
  }

  packages.forEach((packageName) => {
    Object.keys(inData[packageName]).map((date) => {
      const monthKey = getMonthKey(date);
      monthsData[monthKey][packageName] += inData[packageName][date];
    });
  });

  const data: object[] = [];

  Object.keys(monthsData).forEach((date) => {
    const entry = {
      date,
      ...monthsData[date],
      '@mui/base':
        monthsData[date]['@mui/base'] +
        monthsData[date]['@mui/core'] -
        monthsData[date]['@mui/material'],
    };

    delete entry['@mui/material'];
    delete entry['@mui/core'];
    data.push(entry);
  });

  return data;
};

export async function queryHeadlessLibrariesDownloads() {
  const todayDate = new Date();
  const today = `${todayDate.getFullYear()}-${formatDatePart(
    todayDate.getMonth() + 1,
  )}-${formatDatePart(todayDate.getDate())}`;

  const baseDownloadsResponse = await fetch(
    `https://npm-stat.com/api/download-counts?package=%40mui%2Fbase&package=%40mui%2Fmaterial&package=%40mui%2Fcore&from=2022-07-01&until=${today}`,
  );
  const baseDownloads = await baseDownloadsResponse.json();

  const headlessLibrariesDownloadsResponse = await fetch(
    `https://npm-stat.com/api/download-counts?package=%40react-aria%2Futils&package=%40headlessui%2Freact&package=reakit&package=%40radix-ui%2Freact-primitive&package=%40reach%2Futils&from=2022-07-01&until=${today}`,
  );
  const headlessLibrariesDownloads = await headlessLibrariesDownloadsResponse.json();

  const inData = {
    ...baseDownloads,
    ...headlessLibrariesDownloads,
  };
  const data = prepareData(inData);

  return data;
}
