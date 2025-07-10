import { describe, it, expect } from "vitest";
import { GitHubClient } from "../src/github-client.js";
import { JiraClient } from "../src/jira-client.js";

describe("Core Functionality", () => {
  describe("GitHub Client", () => {
    it("should fetch PRs for a month", async () => {
      process.env.GITHUB_TOKEN = "test-token";
      const client = new GitHubClient("test-token");

      const prs = await client.getPRsForMonth("test", "repo", "2024-01");

      expect(Array.isArray(prs)).toBe(true);
      expect(prs[0]).toHaveProperty("number");
      expect(prs[0]).toHaveProperty("title");
    });

    it("should extract JIRA keys from PR content", () => {
      const client = new GitHubClient("test-token");

      const pr = {
        number: 1,
        title: "Fix bug PROJ-123",
        body: "This fixes PROJ-456 and PROJ-789",
        url: "test",
        author: "dev",
        mergedAt: "2024-01-01",
        labels: [],
        commits: 1,
        additions: 1,
        deletions: 1,
        changedFiles: 1,
      };

      const keys = client.extractJiraKeys(pr);

      expect(keys).toContain("PROJ-123");
      expect(keys).toContain("PROJ-456");
      expect(keys).toContain("PROJ-789");
    });
  });

  describe("JIRA Client", () => {
    it("should initialize with basic auth", () => {
      const client = new JiraClient({
        host: "test-jira.com",
        username: "user",
        password: "pass",
      });

      expect(client.isPAT).toBe(false);
    });

    it("should fetch ticket metadata", async () => {
      const client = new JiraClient({
        host: "test-jira.com",
        username: "user",
        password: "pass",
      });

      const tickets = await client.getTicketsMetadata(["PROJ-123"]);

      expect(Array.isArray(tickets)).toBe(true);
      if (tickets.length > 0) {
        expect(tickets[0]).toHaveProperty("key");
        expect(tickets[0]).toHaveProperty("summary");
      }
    });
  });
});
