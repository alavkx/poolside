import { beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Basic handlers for external APIs
const handlers = [
  // GitHub API - list PRs
  http.get("https://api.github.com/repos/*/pulls", () => {
    return HttpResponse.json([
      {
        number: 1,
        title: "Add user authentication",
        body: "Implements PROJ-123 user auth system",
        user: { login: "developer" },
        merged_at: "2024-01-15T10:00:00Z",
        labels: [{ name: "feature" }],
        html_url: "https://github.com/test/repo/pull/1",
        state: "closed",
      },
    ]);
  }),

  // GitHub API - get specific PR
  http.get("https://api.github.com/repos/*/pulls/:number", () => {
    return HttpResponse.json({
      number: 1,
      title: "Add user authentication",
      body: "Implements PROJ-123 user auth system",
      user: { login: "developer" },
      merged_at: "2024-01-15T10:00:00Z",
      labels: [{ name: "feature" }],
      html_url: "https://github.com/test/repo/pull/1",
      commits: 2,
      additions: 50,
      deletions: 10,
      changed_files: 3,
    });
  }),

  // JIRA API - single issue
  http.get("https://test-jira.com/rest/api/2/issue/:key", () => {
    return HttpResponse.json({
      key: "PROJ-123",
      fields: {
        summary: "User authentication system",
        description: "Add secure user authentication",
        status: { name: "Done" },
        issuetype: { name: "Story" },
        assignee: { displayName: "developer" },
        reporter: { displayName: "product-manager" },
        created: "2024-01-10T10:00:00.000Z",
        updated: "2024-01-15T10:00:00.000Z",
        resolutiondate: "2024-01-15T10:00:00.000Z",
        labels: ["security"],
        components: [{ name: "auth" }],
        priority: { name: "High" },
        fixVersions: [],
        comment: { comments: [] },
      },
    });
  }),

  // OpenAI API - chat completions
  http.post("https://api.openai.com/v1/chat/completions", () => {
    return HttpResponse.json({
      choices: [
        {
          index: 0,
          message: {
            content:
              "- Enhanced user authentication system\n- Improved security features",
          },
          finish_reason: "stop",
        },
      ],
    });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

export { server };
