declare module "jira-client" {
  interface JiraApiOptions {
    protocol?: string;
    host: string;
    username: string;
    password: string;
    apiVersion?: string;
    strictSSL?: boolean;
    port?: number;
    timeout?: number;
  }

  export default class JiraApi {
    constructor(options: JiraApiOptions);

    findIssue(issueKey: string): Promise<any>;
    getCurrentUser(): Promise<any>;
    searchJira(jql: string, options?: any): Promise<any>;
    addComment(issueKey: string, comment: string): Promise<any>;
    listTransitions(issueKey: string): Promise<any>;
    transitionIssue(issueKey: string, transitionData: any): Promise<any>;
    updateIssue(issueKey: string, updateData: any): Promise<any>;
  }
}
