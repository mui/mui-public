type Connection = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type User = {
  login: string;
};

type Author = {
  user: User | null;
};

type PrLabel = {
  name: string;
};

type PullRequestNode = {
  author: Author;
  number: number;
  labels: {
    nodes: PrLabel[];
  };
};

export type CommitNode = {
  oid: string;
  authoredDate: string;
  author: Author;
  message: string;
  associatedPullRequests: {
    nodes: PullRequestNode[];
  };
};

export type CommitConnection = {
  nodes: CommitNode[];
  pageInfo: Connection;
};
