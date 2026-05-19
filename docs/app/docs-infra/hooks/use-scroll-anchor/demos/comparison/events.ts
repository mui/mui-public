export type TimelineEvent = {
  id: string;
  time: string;
  title: string;
  body: string;
};

export const olderEvents: TimelineEvent[] = [
  {
    id: 'e1',
    time: '08:14',
    title: 'Build started',
    body: 'CI picked up commit a1b2c3d on the release branch.',
  },
  {
    id: 'e2',
    time: '08:21',
    title: 'Tests queued',
    body: 'Sharding 1,284 specs across 8 runners.',
  },
  {
    id: 'e3',
    time: '08:34',
    title: 'Lint passed',
    body: 'No new warnings introduced; 0 errors across 482 files.',
  },
  {
    id: 'e4',
    time: '08:41',
    title: 'Unit tests passed',
    body: '1,284 specs, 0 failures, 17 skipped.',
  },
  {
    id: 'e5',
    time: '08:55',
    title: 'Bundle uploaded',
    body: 'Artifact pushed to staging at s3://artifacts/release/2.4.0.tar.gz.',
  },
  {
    id: 'e6',
    time: '09:02',
    title: 'Smoke tests started',
    body: 'Spawning 12 browsers across 3 regions.',
  },
];

export const visibleEvents: TimelineEvent[] = [
  {
    id: 'now1',
    time: '09:14',
    title: 'Smoke tests passed',
    body: 'All regions green. Ready for canary rollout.',
  },
  {
    id: 'now2',
    time: '09:18',
    title: 'Canary deployed',
    body: '5% of traffic routed to release-2.4.0. Monitoring error budget.',
  },
  {
    id: 'now3',
    time: '09:31',
    title: 'Rollout complete',
    body: '100% of traffic on release-2.4.0. No regression detected over 13m window.',
  },
];
