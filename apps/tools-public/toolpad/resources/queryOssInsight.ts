export async function queryOssInsight(repositoryId: string, query: string) {
  const res = await fetch('https://api.ossinsight.io/q/playground', {
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({
      type: 'repo',
      sql: query,
      id: repositoryId,
    }),
  });
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const json = await res.json();
  return json.data;
}
