export const ISSUES_BY_STATES_QUERY = `
query IssuesByStates($projectSlug: String!, $states: [String!]!, $cursor: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $states } }
    }
    first: 50
    after: $cursor
    orderBy: createdAt
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      branchName
      url
      labels { nodes { name } }
      relations(type: "blocks") {
        nodes {
          relatedIssue { id identifier state { name } }
        }
      }
      createdAt
      updatedAt
    }
  }
}
`;

export const ISSUE_STATES_BY_IDS_QUERY = `
query IssueStatesByIds($ids: [String!]!, $cursor: String) {
  issues(
    filter: { id: { in: $ids } }
    first: 50
    after: $cursor
    orderBy: createdAt
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      state { name }
    }
  }
}
`;
