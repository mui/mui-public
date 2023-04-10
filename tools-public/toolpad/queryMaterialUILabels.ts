import { createQuery } from "@mui/toolpad-core";
import { request } from "graphql-request";

export const queryMaterialUILabels = createQuery(
  async ({ parameters }) => {
   
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Env variable GITHUB_TOKEN not configured`);
  }

   
      const endpoint = 'https://api.github.com/graphql';
      const token = process.env.GITHUB_TOKEN;  
        
      const  query = `
  {
    repository(owner: "mui", name: "material-ui") {
      pullRequests(first: 50, orderBy: {direction: DESC, field: CREATED_AT}) {
        nodes {
          number
          url
          title
          timelineItems(itemTypes: LABELED_EVENT, first: 100) {
            nodes {
              ... on LabeledEvent {
                label {
                  name
                }
                actor {
                  login
                }
              }
            }
          }
        }
      }
      issues(first: 50, orderBy: { direction: DESC, field: CREATED_AT }) {
        nodes {
          number
          url
          title
          timelineItems(itemTypes: LABELED_EVENT, first: 100) {
            nodes {
              ... on LabeledEvent {
                label {
                  name
                }
                actor {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
        `
  
  
  const response =  await request(endpoint, query, null, {
    Authorization: `Bearer ${token}`,
  })
  
  return response;

})
