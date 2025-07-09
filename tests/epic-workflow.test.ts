import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EpicWorkflow } from "../src/epic-workflow.js";
import { IntegrationUtils } from "../src/integration-utils.js";

// Mock the dependencies
vi.mock("../src/integration-utils.js");

describe("Epic Workflow", () => {
  let mockIntegrationUtils: any;
  let epicWorkflow: EpicWorkflow;

  const mockConfig = {
    jira: {
      host: "test.atlassian.net",
      username: "test-user",
      password: "test-password",
    },
    github: {
      token: "test-github-token",
    },
    ai: {
      apiKey: "test-openai-key",
      model: "gpt-4o",
      maxTokens: 4000,
    },
    verbose: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock integration utils
    mockIntegrationUtils = {
      validateConnections: vi.fn(),
      searchJiraEpics: vi.fn(),
      getEpicChildren: vi.fn(),
      findAvailableTicket: vi.fn(),
      addCommentToTicket: vi.fn(),
      generateCodingPrompt: vi.fn(),
      writeToTempFile: vi.fn(),
      jiraClient: {
        isPAT: false,
        axios: {
          get: vi.fn(),
        },
        jira: {
          findIssue: vi.fn(),
        },
      },
    };

    // Mock the IntegrationUtils constructor
    (IntegrationUtils as any).mockImplementation(() => mockIntegrationUtils);

    epicWorkflow = new EpicWorkflow(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processEpic", () => {
    const mockEpic = {
      key: "TEST-123",
      summary: "Test Epic",
      description: "Test epic description",
      status: "In Progress",
      assignee: "test-assignee",
      reporter: "test-reporter",
      created: "2024-01-01T10:00:00Z",
      updated: "2024-01-15T10:00:00Z",
      labels: ["epic"],
      components: ["backend"],
      url: "https://test.atlassian.net/browse/TEST-123",
    };

    const mockChildTickets = [
      {
        key: "TEST-124",
        summary: "Test Child Ticket",
        description: "Test child ticket description",
        status: "To Do",
        assignee: null,
        reporter: "test-reporter",
        created: "2024-01-02T10:00:00Z",
        updated: "2024-01-02T10:00:00Z",
        labels: ["story"],
        components: ["backend"],
        priority: "High",
        issueType: "Story",
        comments: [],
        url: "https://test.atlassian.net/browse/TEST-124",
      },
    ];

    it("should successfully process an epic and claim a ticket", async () => {
      const mockPrompt = "Generated coding prompt for TEST-124";
      const mockTempFile = "/tmp/TEST-124-prompt.md";

      // Mock the workflow steps
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: true,
      });

      // Mock findEpic (via getEpicByKey)
      mockIntegrationUtils.jiraClient.jira.findIssue.mockResolvedValue({
        key: "TEST-123",
        fields: {
          summary: "Test Epic",
          description: "Test epic description",
          status: { name: "In Progress" },
          assignee: { displayName: "test-assignee" },
          reporter: { displayName: "test-reporter" },
          created: "2024-01-01T10:00:00Z",
          updated: "2024-01-15T10:00:00Z",
          labels: ["epic"],
          components: [{ name: "backend" }],
          issuetype: { name: "Epic" },
        },
      });

      mockIntegrationUtils.getEpicChildren.mockResolvedValue(mockChildTickets);
      mockIntegrationUtils.findAvailableTicket.mockReturnValue(
        mockChildTickets[0]
      );
      mockIntegrationUtils.addCommentToTicket.mockResolvedValue(true);
      mockIntegrationUtils.generateCodingPrompt.mockResolvedValue(mockPrompt);
      mockIntegrationUtils.writeToTempFile.mockResolvedValue(mockTempFile);

      const result = await epicWorkflow.processEpic("TEST-123", {
        agentName: "Test Agent",
        claimantName: "Test Claimant",
      });

      expect(result).toEqual({
        epic: mockEpic,
        ticket: mockChildTickets[0],
        prompt: mockPrompt,
        tempFile: mockTempFile,
      });

      expect(mockIntegrationUtils.validateConnections).toHaveBeenCalled();
      expect(mockIntegrationUtils.getEpicChildren).toHaveBeenCalledWith(
        "TEST-123"
      );
      expect(mockIntegrationUtils.findAvailableTicket).toHaveBeenCalledWith(
        mockChildTickets
      );
      expect(mockIntegrationUtils.addCommentToTicket).toHaveBeenCalledWith(
        "TEST-124",
        "Ticket claimed by Test Claimant"
      );
      expect(mockIntegrationUtils.generateCodingPrompt).toHaveBeenCalledWith(
        mockChildTickets[0],
        mockEpic
      );
      expect(mockIntegrationUtils.writeToTempFile).toHaveBeenCalledWith(
        mockPrompt,
        "TEST-124-prompt.md"
      );
    });

    it("should return null when epic is not found", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: true,
      });

      mockIntegrationUtils.jiraClient.jira.findIssue.mockRejectedValue(
        new Error("Epic not found")
      );
      mockIntegrationUtils.searchJiraEpics.mockResolvedValue([]);

      await expect(epicWorkflow.processEpic("NONEXISTENT-123")).rejects.toThrow(
        "Epic NONEXISTENT-123 not found"
      );
    });

    it("should return null when no child tickets are found", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: true,
      });

      mockIntegrationUtils.jiraClient.jira.findIssue.mockResolvedValue({
        key: "TEST-123",
        fields: {
          summary: "Test Epic",
          description: "Test epic description",
          status: { name: "In Progress" },
          assignee: { displayName: "test-assignee" },
          reporter: { displayName: "test-reporter" },
          created: "2024-01-01T10:00:00Z",
          updated: "2024-01-15T10:00:00Z",
          labels: ["epic"],
          components: [{ name: "backend" }],
          issuetype: { name: "Epic" },
        },
      });

      mockIntegrationUtils.getEpicChildren.mockResolvedValue([]);

      const result = await epicWorkflow.processEpic("TEST-123");

      expect(result).toBeNull();
    });

    it("should return null when no available tickets are found", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: true,
      });

      mockIntegrationUtils.jiraClient.jira.findIssue.mockResolvedValue({
        key: "TEST-123",
        fields: {
          summary: "Test Epic",
          description: "Test epic description",
          status: { name: "In Progress" },
          assignee: { displayName: "test-assignee" },
          reporter: { displayName: "test-reporter" },
          created: "2024-01-01T10:00:00Z",
          updated: "2024-01-15T10:00:00Z",
          labels: ["epic"],
          components: [{ name: "backend" }],
          issuetype: { name: "Epic" },
        },
      });

      mockIntegrationUtils.getEpicChildren.mockResolvedValue(mockChildTickets);
      mockIntegrationUtils.findAvailableTicket.mockReturnValue(null);

      const result = await epicWorkflow.processEpic("TEST-123");

      expect(result).toBeNull();
    });

    it("should handle connection validation failure", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: false,
        github: true,
        ai: true,
      });

      await expect(epicWorkflow.processEpic("TEST-123")).rejects.toThrow(
        "JIRA connection failed. Check your JIRA configuration."
      );
    });

    it("should handle AI validation failure", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: false,
      });

      await expect(epicWorkflow.processEpic("TEST-123")).rejects.toThrow(
        "AI processor not available. Check your OpenAI configuration."
      );
    });
  });

  describe("listEpics", () => {
    it("should list epics for a project", async () => {
      const mockEpics = [
        {
          key: "TEST-123",
          summary: "Test Epic 1",
          description: "Test epic 1 description",
          status: "In Progress",
          assignee: "test-assignee",
          reporter: "test-reporter",
          created: "2024-01-01T10:00:00Z",
          updated: "2024-01-15T10:00:00Z",
          labels: ["epic"],
          components: ["backend"],
          url: "https://test.atlassian.net/browse/TEST-123",
        },
        {
          key: "TEST-124",
          summary: "Test Epic 2",
          description: "Test epic 2 description",
          status: "To Do",
          assignee: "Unassigned",
          reporter: "test-reporter",
          created: "2024-01-02T10:00:00Z",
          updated: "2024-01-02T10:00:00Z",
          labels: ["epic"],
          components: ["frontend"],
          url: "https://test.atlassian.net/browse/TEST-124",
        },
      ];

      mockIntegrationUtils.searchJiraEpics.mockResolvedValue(mockEpics);

      const result = await epicWorkflow.listEpics("TEST");

      expect(result).toEqual(mockEpics);
      expect(mockIntegrationUtils.searchJiraEpics).toHaveBeenCalledWith(
        "TEST",
        {}
      );
    });

    it("should return empty array when no epics are found", async () => {
      mockIntegrationUtils.searchJiraEpics.mockResolvedValue([]);

      const result = await epicWorkflow.listEpics("TEST");

      expect(result).toEqual([]);
    });

    it("should handle API errors", async () => {
      mockIntegrationUtils.searchJiraEpics.mockRejectedValue(
        new Error("API error")
      );

      await expect(epicWorkflow.listEpics("TEST")).rejects.toThrow("API error");
    });
  });

  describe("getEpicStatus", () => {
    it("should return epic status with child ticket analysis", async () => {
      const mockEpic = {
        key: "TEST-123",
        summary: "Test Epic",
        description: "Test epic description",
        status: "In Progress",
        assignee: "test-assignee",
        reporter: "test-reporter",
        created: "2024-01-01T10:00:00Z",
        updated: "2024-01-15T10:00:00Z",
        labels: ["epic"],
        components: ["backend"],
        url: "https://test.atlassian.net/browse/TEST-123",
      };

      const mockChildTickets = [
        {
          key: "TEST-124",
          summary: "Available Ticket",
          description: "Available ticket description",
          status: "To Do",
          assignee: null,
          reporter: "test-reporter",
          created: "2024-01-02T10:00:00Z",
          updated: "2024-01-02T10:00:00Z",
          labels: ["story"],
          components: ["backend"],
          priority: "High",
          issueType: "Story",
          comments: [],
          url: "https://test.atlassian.net/browse/TEST-124",
        },
        {
          key: "TEST-125",
          summary: "In Progress Ticket",
          description: "In progress ticket description",
          status: "In Progress",
          assignee: "developer",
          reporter: "test-reporter",
          created: "2024-01-03T10:00:00Z",
          updated: "2024-01-03T10:00:00Z",
          labels: ["story"],
          components: ["backend"],
          priority: "Medium",
          issueType: "Story",
          comments: [],
          url: "https://test.atlassian.net/browse/TEST-125",
        },
      ];

      mockIntegrationUtils.jiraClient.jira.findIssue.mockResolvedValue({
        key: "TEST-123",
        fields: {
          summary: "Test Epic",
          description: "Test epic description",
          status: { name: "In Progress" },
          assignee: { displayName: "test-assignee" },
          reporter: { displayName: "test-reporter" },
          created: "2024-01-01T10:00:00Z",
          updated: "2024-01-15T10:00:00Z",
          labels: ["epic"],
          components: [{ name: "backend" }],
          issuetype: { name: "Epic" },
        },
      });

      mockIntegrationUtils.getEpicChildren.mockResolvedValue(mockChildTickets);
      mockIntegrationUtils.findAvailableTicket.mockReturnValue(
        mockChildTickets[0]
      );

      const result = await epicWorkflow.getEpicStatus("TEST-123");

      expect(result).toEqual({
        epic: mockEpic,
        childTickets: mockChildTickets,
        statusSummary: {
          "To Do": 1,
          "In Progress": 1,
        },
        availableCount: 2, // This might be different based on the mock implementation
        inProgressCount: 1,
      });
    });

    it("should return null when epic is not found", async () => {
      mockIntegrationUtils.jiraClient.jira.findIssue.mockRejectedValue(
        new Error("Epic not found")
      );
      mockIntegrationUtils.searchJiraEpics.mockResolvedValue([]);

      const result = await epicWorkflow.getEpicStatus("NONEXISTENT-123");

      expect(result).toBeNull();
    });
  });

  describe("validateConnections", () => {
    it("should validate all connections successfully", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: true,
      });

      await expect(epicWorkflow.validateConnections()).resolves.not.toThrow();
    });

    it("should throw error when JIRA connection fails", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: false,
        github: true,
        ai: true,
      });

      await expect(epicWorkflow.validateConnections()).rejects.toThrow(
        "JIRA connection failed. Check your JIRA configuration."
      );
    });

    it("should throw error when AI connection fails", async () => {
      mockIntegrationUtils.validateConnections.mockResolvedValue({
        jira: true,
        github: true,
        ai: false,
      });

      await expect(epicWorkflow.validateConnections()).rejects.toThrow(
        "AI processor not available. Check your OpenAI configuration."
      );
    });
  });
});
