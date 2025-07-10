// Type definitions for jira-client
// These are external library types that require 'any' for compatibility

declare module "jira-client" {
  export interface JiraApiOptions {
    protocol: string;
    host: string;
    username: string;
    password: string;
    apiVersion: string;
    strictSSL: boolean;
  }

  export default class JiraApi {
    constructor(options: JiraApiOptions);

    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    findIssue(issueKey: string): Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    getCurrentUser(): Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    searchJira(jql: string, options?: any): Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    addComment(issueKey: string, comment: string): Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    listTransitions(issueKey: string): Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    transitionIssue(issueKey: string, transitionData: any): Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: External library type definition
    updateIssue(issueKey: string, updateData: any): Promise<any>;
  }
}
