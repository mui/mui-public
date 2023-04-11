import { createQuery } from "@mui/toolpad-core";
import { request } from "graphql-request";

export const queryPRs = createQuery(
  async ({ parameters }) => {
   
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

   
      const endpoint = 'https://api.github.com/graphql';
      const token = process.env.GITHUB_TOKEN;  
        
      const  query = `
      {
        materialui: repository(owner: "mui", name: "material-ui") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
            states: OPEN
          ) {
            nodes {
              number
              url
              title
              state
              repository {
                name
              }
              isDraft
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
        muix: repository(owner: "mui", name: "mui-x") {
          pullRequests(
            first: 100
            orderBy: {direction: DESC, field: CREATED_AT}
          ) {
            nodes {
              number
              url
              title
              state
              repository {
                name
              }
              isDraft
              labels(first: 10) {
                nodes {
                  name
                }
              }
            }
          }
        }
      }
            `
  
  
  const response = await request(endpoint, query, null, {
    Authorization: `Bearer ${token}`,
  })
  
  return response;

  /*
  const result = await response.json();
  return result.data.materialui.pullRequests.nodes
    .concat(result.data.muix.pullRequests.nodes)
    .map((x) => ({ ...x, repository: x.repository.name }));
  
  */

})
