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

export type AuthorAssocation =
  | 'MEMBER'
  | 'OWNER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'NONE'
  | 'MANNEQUIN';

type PullRequestNode = {
  author: Author;
  number: number;
  authorAssociation: AuthorAssocation;
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
