import { format } from "date-fns";

interface RepoConfig {
  name: string;
  repo: string;
  description?: string;
  priority?: number;
  includeInSummary?: boolean;
  categories?: Record<string, string>;
}

interface ReleaseConfig {
  month?: string;
  outputFile?: string;
  title?: string;
  description?: string;
  includeTableOfContents: boolean;
  includeSummary: boolean;
}

interface TotalStats {
  totalPRs: number;
  totalJiraTickets: number;
  successfulRepos: number;
  totalRepos: number;
}

interface RepoData {
  repoConfig: RepoConfig;
  prData: any[];
  jiraTickets: any[];
  releaseNotesData?: Record<string, string[]>;
  error?: string;
}

interface MarkdownGeneratorParams {
  releaseConfig: ReleaseConfig;
  targetMonth: string;
  allRepoData: RepoData[];
  totalStats: TotalStats;
}

export class MarkdownGenerator {
  generateMultiRepoMarkdown({
    releaseConfig,
    targetMonth,
    allRepoData,
    totalStats,
  }: MarkdownGeneratorParams): string {
    const sections: string[] = [];

    // Main header
    sections.push(
      this.generateMainHeader(releaseConfig, targetMonth, totalStats)
    );

    // Executive summary
    if (releaseConfig.includeSummary) {
      sections.push(this.generateExecutiveSummary(allRepoData, totalStats));
    }

    // Table of contents
    if (releaseConfig.includeTableOfContents) {
      sections.push(this.generateTableOfContents(allRepoData, releaseConfig));
    }

    // Repository sections
    sections.push(this.generateRepositorySections(allRepoData));

    // Optional: Statistics and metrics
    sections.push(this.generateStatisticsSection(totalStats, allRepoData));

    return sections.join("\n\n");
  }

  generateMainHeader(
    releaseConfig: ReleaseConfig,
    targetMonth: string,
    totalStats: TotalStats
  ): string {
    const [year, monthNum] = targetMonth.split("-");
    const monthName = format(
      new Date(Number(year), Number(monthNum) - 1),
      "MMMM yyyy"
    );

    const title = releaseConfig.title || "Multi-Repository Release Notes";
    const description =
      releaseConfig.description ||
      "Comprehensive release notes across all repositories";

    return `# ${title} - ${monthName}

**Release Date:** ${format(new Date(), "MMMM do, yyyy")}  
**Repositories:** ${totalStats.totalRepos}  
**Total Changes:** ${totalStats.totalPRs} pull requests  

${description}

---`;
  }

  generateExecutiveSummary(
    allRepoData: RepoData[],
    totalStats: TotalStats
  ): string {
    const summaryRepos = allRepoData.filter(
      (repo) =>
        repo.repoConfig.includeInSummary &&
        !repo.error &&
        Object.values(repo.releaseNotesData || {}).flat().length > 0
    );

    if (summaryRepos.length === 0) {
      return `## 🎯 This Month's Highlights

This month focused on behind-the-scenes improvements and maintenance across our platform to ensure the best possible experience for our users.`;
    }

    // Aggregate changes by type across all summary repos
    const aggregatedChanges: Record<string, string[]> = {
      features: [],
      improvements: [],
      bugs: [],
      other: [],
    };

    summaryRepos.forEach((repo) => {
      Object.entries(repo.releaseNotesData || {}).forEach(
        ([category, entries]) => {
          if (aggregatedChanges[category]) {
            aggregatedChanges[category].push(...entries);
          }
        }
      );
    });

    const totalChanges = Object.values(aggregatedChanges).flat().length;
    const changeTypes: string[] = [];

    if (aggregatedChanges.features.length > 0) {
      changeTypes.push(
        `**${aggregatedChanges.features.length}** new features and capabilities`
      );
    }
    if (aggregatedChanges.improvements.length > 0) {
      changeTypes.push(
        `**${aggregatedChanges.improvements.length}** enhancements and optimizations`
      );
    }
    if (aggregatedChanges.bugs.length > 0) {
      changeTypes.push(
        `**${aggregatedChanges.bugs.length}** fixes and stability improvements`
      );
    }

    const changesSummary =
      changeTypes.length > 0
        ? changeTypes.join(", ")
        : `**${totalChanges}** improvements and updates`;

    // Generate top highlights from features and improvements
    const topHighlights = [
      ...aggregatedChanges.features.slice(0, 3),
      ...aggregatedChanges.improvements.slice(0, 2),
    ].slice(0, 4);

    let highlightsText = "";
    if (topHighlights.length > 0) {
      highlightsText = `

### Key Highlights:

${topHighlights.map((highlight) => `- ${highlight}`).join("\n")}`;
    }

    return `## 🎯 This Month's Highlights

This month we delivered ${changesSummary} across **${summaryRepos.length}** repositories.${highlightsText}

---`;
  }

  generateTableOfContents(
    allRepoData: RepoData[],
    releaseConfig: ReleaseConfig
  ): string {
    const repoSections = allRepoData
      .filter((repo) => !repo.error)
      .sort(
        (a, b) =>
          (a.repoConfig.priority || 999) - (b.repoConfig.priority || 999)
      )
      .map((repo) => {
        const hasChanges =
          Object.values(repo.releaseNotesData || {}).flat().length > 0;
        const anchor = repo.repoConfig.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-");
        return `  - [${repo.repoConfig.name}](#${anchor})${
          hasChanges ? "" : " *(no customer-facing changes)*"
        }`;
      });

    const sections = [
      "- [🎯 This Month's Highlights](#-this-months-highlights)",
      "- [📦 Repository Updates](#-repository-updates)",
      ...repoSections,
      "- [📊 Statistics & Metrics](#-statistics--metrics)",
    ];

    if (!releaseConfig.includeSummary) {
      sections.shift(); // Remove highlights section if not included
    }

    return `## 📋 Table of Contents

${sections.join("\n")}

---`;
  }

  generateRepositorySections(allRepoData: RepoData[]): string {
    const sortedRepos = allRepoData.sort(
      (a, b) => (a.repoConfig.priority || 999) - (b.repoConfig.priority || 999)
    );

    const repoSections = sortedRepos.map((repo) => {
      if (repo.error) {
        return this.generateErrorSection(repo);
      }
      return this.generateRepoSection(repo);
    });

    return `## 📦 Repository Updates

${repoSections.join("\n\n")}`;
  }

  generateRepoSection(repo: RepoData): string {
    const { repoConfig, releaseNotesData = {} } = repo;
    const anchor = repoConfig.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    const totalChanges = Object.values(releaseNotesData).flat().length;

    let header = `### ${repoConfig.name}`;

    if (repoConfig.description) {
      header += `\n*${repoConfig.description}*`;
    }

    if (totalChanges === 0) {
      return `${header}

No customer-facing changes this month - focused on internal improvements and maintenance.`;
    }

    const sections: string[] = [];

    // Features
    if (releaseNotesData.features && releaseNotesData.features.length > 0) {
      sections.push(`#### ✨ New Features

${releaseNotesData.features.map((feature) => `- ${feature}`).join("\n")}`);
    }

    // Improvements
    if (
      releaseNotesData.improvements &&
      releaseNotesData.improvements.length > 0
    ) {
      sections.push(`#### 🚀 Improvements

${releaseNotesData.improvements
  .map((improvement) => `- ${improvement}`)
  .join("\n")}`);
    }

    // Bug Fixes
    if (releaseNotesData.bugs && releaseNotesData.bugs.length > 0) {
      sections.push(`#### 🐛 Bug Fixes

${releaseNotesData.bugs.map((bug) => `- ${bug}`).join("\n")}`);
    }

    // Other Changes
    if (releaseNotesData.other && releaseNotesData.other.length > 0) {
      sections.push(`#### 📋 Other Updates

${releaseNotesData.other.map((other) => `- ${other}`).join("\n")}`);
    }

    return `${header}

${sections.join("\n\n")}`;
  }

  generateErrorSection(repo: RepoData): string {
    const { repoConfig, error } = repo;

    return `### ${repoConfig.name}

⚠️ **Unable to generate release notes for this repository**

*Reason: ${error}*

Please check the repository configuration and try again.`;
  }

  generateStatisticsSection(
    totalStats: TotalStats,
    allRepoData: RepoData[]
  ): string {
    const successfulRepos = allRepoData.filter((repo) => !repo.error);
    const failedRepos = allRepoData.filter((repo) => repo.error);

    const totalEntries = successfulRepos.reduce(
      (sum, repo) =>
        sum + Object.values(repo.releaseNotesData || {}).flat().length,
      0
    );

    const categoryBreakdown = successfulRepos.reduce((acc, repo) => {
      Object.entries(repo.releaseNotesData || {}).forEach(
        ([category, entries]) => {
          acc[category] = (acc[category] || 0) + entries.length;
        }
      );
      return acc;
    }, {} as Record<string, number>);

    const breakdownText = Object.entries(categoryBreakdown)
      .filter(([_, count]) => count > 0)
      .map(
        ([category, count]) =>
          `- **${
            category.charAt(0).toUpperCase() + category.slice(1)
          }:** ${count} entries`
      )
      .join("\n");

    let stats = `## 📊 Statistics & Metrics

### Summary
- **Total Repositories:** ${totalStats.totalRepos}
- **Successfully Processed:** ${totalStats.successfulRepos}
- **Total Pull Requests:** ${totalStats.totalPRs}
- **Total JIRA Tickets:** ${totalStats.totalJiraTickets}
- **Release Note Entries:** ${totalEntries}

### Breakdown by Category
${breakdownText || "No categorized entries"}`;

    if (failedRepos.length > 0) {
      stats += `

### ⚠️ Processing Issues
The following repositories encountered issues during processing:

${failedRepos
  .map((repo) => `- **${repo.repoConfig.name}:** ${repo.error}`)
  .join("\n")}`;
    }

    stats += `

---

*Release notes generated on ${format(new Date(), "PPP")} at ${format(
      new Date(),
      "pp"
    )}*  
*Generated by Poolside CLI*`;

    return stats;
  }
}
