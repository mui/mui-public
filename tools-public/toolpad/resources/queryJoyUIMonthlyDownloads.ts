import { formatDatePart, getDateString, getMonthKey } from './queryHeadlessLibrariesDownloads';

const prepareData = (inData) => {
  const date = new Date(2022, 6, 1, 0, 0, 0, 0);
  const today = new Date();
  const monthsData = {};

  while (date < today) {
    monthsData[getDateString(date)] = {
      '@mui/joy': 0,
    };
    date.setMonth(date.getMonth() + 1);
  }

  Object.keys(inData['@mui/joy']).map((date) => {
    const monthKey = getMonthKey(date);
    monthsData[monthKey]['@mui/joy'] += inData['@mui/joy'][date];
  });

  const data: object[] = [];

  Object.keys(monthsData).forEach((date) => {
    const entry = {
      date,
      ...monthsData[date],
    };
    data.push(entry);
  });

  return data;
};

export async function queryJoyUIDownloads() {
  const todayDate = new Date();
  const today = `${todayDate.getFullYear()}-${formatDatePart(
    todayDate.getMonth() + 1,
  )}-${formatDatePart(todayDate.getDate())}`;

  const joyDownloadsResponse = await fetch(
    `https://npm-stat.com/api/download-counts?package=%40mui%2Fjoy&from=2022-07-01&until=${today}`,
  );
  const joyDownloads = await joyDownloadsResponse.json();

  const data = prepareData(joyDownloads);

  return data;
}
