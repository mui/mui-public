export const isSameGitHubActor = (actor, trustedActor) =>
  typeof actor?.id === 'string' &&
  typeof actor?.type === 'string' &&
  actor.id === trustedActor?.id &&
  actor.type === trustedActor?.type;

export const selectDashboardIssue = (issues, title, trustedActor) =>
  issues.find(
    (issue) =>
      issue.title === title &&
      isSameGitHubActor(
        {
          id: issue.author?.id,
          type: issue.author?.is_bot ? 'Bot' : 'User',
        },
        trustedActor,
      ),
  )?.number ?? null;
