import { format } from 'date-fns';

export class MarkdownGenerator {
  generateMultiRepoMarkdown({ releaseConfig, targetMonth, allRepoData, totalStats }) {
    const sections = [];
    
    // Main header
    sections.push(this.generateMainHeader(releaseConfig, targetMonth, totalStats));
    
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
    
    return sections.join('\n\n');
  }

  generateMainHeader(releaseConfig, targetMonth, totalStats) {
    const [year, monthNum] = targetMonth.split('-');
    const monthName = format(new Date(year, monthNum - 1), 'MMMM yyyy');
    
    const title = releaseConfig.title || 'Multi-Repository Release Notes';
    const description = releaseConfig.description || 'Comprehensive release notes across all repositories';
    
    return `# ${title} - ${monthName}

**Release Date:** ${format(new Date(), 'MMMM do, yyyy')}  
**Repositories:** ${totalStats.totalRepos}  
**Total Changes:** ${totalStats.totalPRs} pull requests  

${description}

---`;
  }

  generateExecutiveSummary(allRepoData, totalStats) {
    const summaryRepos = allRepoData.filter(repo => 
      repo.repoConfig.includeInSummary && 
      !repo.error && 
      Object.values(repo.releaseNotesData || {}).flat().length > 0
    );
    
    if (summaryRepos.length === 0) {
      return `## 🎯 This Month's Highlights

This month focused on behind-the-scenes improvements and maintenance across our platform to ensure the best possible experience for our users.`;
    }

    // Aggregate changes by type across all summary repos
    const aggregatedChanges = {
      features: [],
      improvements: [],
      bugs: [],
      other: []
    };
    
    summaryRepos.forEach(repo => {
      Object.entries(repo.releaseNotesData || {}).forEach(([category, entries]) => {
        if (aggregatedChanges[category]) {
          aggregatedChanges[category].push(...entries);
        }
      });
    });

    const totalChanges = Object.values(aggregatedChanges).flat().length;
    const changeTypes = [];
    
    if (aggregatedChanges.features.length > 0) {
      changeTypes.push(`**${aggregatedChanges.features.length}** new features and capabilities`);
    }
    if (aggregatedChanges.improvements.length > 0) {
      changeTypes.push(`**${aggregatedChanges.improvements.length}** enhancements and optimizations`);
    }
    if (aggregatedChanges.bugs.length > 0) {
      changeTypes.push(`**${aggregatedChanges.bugs.length}** fixes and stability improvements`);
    }

    const changesSummary = changeTypes.length > 0 
      ? changeTypes.join(', ')
      : `**${totalChanges}** improvements and updates`;

    // Generate top highlights from features and improvements
    const topHighlights = [
      ...aggregatedChanges.features.slice(0, 3),
      ...aggregatedChanges.improvements.slice(0, 2)
    ].slice(0, 4);

    let highlightsText = '';
    if (topHighlights.length > 0) {
      highlightsText = `\n\n**Key Highlights:**\n${topHighlights.map(highlight => `• ${highlight}`).join('\n')}`;
    }

    return `## 🎯 This Month's Highlights

We're excited to share ${changesSummary} designed to improve your experience and productivity across our platform.${highlightsText}`;
  }

  generateTableOfContents(allRepoData, releaseConfig) {
    const tocEntries = [];
    
    // Add summary if enabled
    if (releaseConfig.includeSummary) {
      tocEntries.push('- [🎯 This Month\'s Highlights](#-this-months-highlights)');
    }
    
    // Add repository sections
    const visibleRepos = allRepoData.filter(repo => 
      !repo.error && Object.values(repo.releaseNotesData || {}).flat().length > 0
    );
    
    visibleRepos.forEach(repo => {
      const anchor = this.createAnchor(repo.repoConfig.name);
      tocEntries.push(`- [📦 ${repo.repoConfig.name}](#-${anchor})`);
      
      // Add category subsections
      const categories = Object.entries(repo.releaseNotesData || {})
        .filter(([_, entries]) => entries.length > 0);
      
      categories.forEach(([category, _]) => {
        const categoryTitle = this.getCategoryTitle(category);
        const categoryAnchor = this.createAnchor(`${repo.repoConfig.name} ${categoryTitle}`);
        tocEntries.push(`  - [${categoryTitle}](#${categoryAnchor})`);
      });
    });
    
    // Add statistics section
    tocEntries.push('- [📊 Release Statistics](#-release-statistics)');
    
    return `## 📚 Table of Contents

${tocEntries.join('\n')}`;
  }

  generateRepositorySections(allRepoData) {
    const sections = [];
    
    // Sort by priority and filter out repos with no changes
    const visibleRepos = allRepoData
      .filter(repo => !repo.error && Object.values(repo.releaseNotesData || {}).flat().length > 0)
      .sort((a, b) => (a.repoConfig.priority || 999) - (b.repoConfig.priority || 999));
    
    if (visibleRepos.length === 0) {
      sections.push(`## 🔧 Development Updates

This month focused on internal improvements and optimizations across our platform to enhance performance and reliability. While these changes aren't directly visible, they help ensure you have the best possible experience.`);
      return sections.join('\n\n');
    }
    
    visibleRepos.forEach(repo => {
      sections.push(this.generateRepositorySection(repo));
    });
    
    // Add section for repos with errors if any
    const failedRepos = allRepoData.filter(repo => repo.error);
    if (failedRepos.length > 0) {
      const failedSection = `## ⚠️ Processing Notes

The following repositories encountered issues during processing and are not included in these release notes:

${failedRepos.map(repo => `- **${repo.repoConfig.name}**: ${repo.error}`).join('\n')}

*These issues will be resolved for the next release notes generation.*`;
      
      sections.push(failedSection);
    }
    
    return sections.join('\n\n');
  }

  generateRepositorySection(repoData) {
    const { repoConfig, releaseNotesData, prData, jiraTickets } = repoData;
    const sections = [];
    
    // Repository header
    const repoTitle = `## 📦 ${repoConfig.name}`;
    const repoInfo = [];
    
    if (repoConfig.description) {
      repoInfo.push(repoConfig.description);
    }
    
    repoInfo.push(`**${prData.length}** pull request${prData.length !== 1 ? 's' : ''} processed`);
    
    if (jiraTickets.length > 0) {
      repoInfo.push(`**${jiraTickets.length}** JIRA ticket${jiraTickets.length !== 1 ? 's' : ''} linked`);
    }
    
    sections.push(`${repoTitle}

${repoInfo.join(' • ')}`);
    
    // Process categories in priority order
    const categoryOrder = ['features', 'improvements', 'bugs', 'other'];
    
    categoryOrder.forEach(category => {
      const entries = releaseNotesData[category];
      if (!entries || entries.length === 0) return;

      const categoryConfig = this.getCategoryConfig(category, repoConfig);
      sections.push(`### ${categoryConfig.title}

${categoryConfig.intro}

${entries.map(entry => `- ${entry}`).join('\n')}`);
    });
    
    // If no entries were found, add a placeholder
    const totalEntries = Object.values(releaseNotesData).flat().length;
    if (totalEntries === 0) {
      sections.push(`### 🔧 Internal Improvements

This repository received internal improvements and optimizations that enhance performance and reliability behind the scenes.`);
    }
    
    return sections.join('\n\n');
  }

  generateStatisticsSection(totalStats, allRepoData) {
    const sections = [];
    
    sections.push(`## 📊 Release Statistics

### Overview
- **Repositories Processed:** ${totalStats.successfulRepos}/${totalStats.totalRepos}
- **Total Pull Requests:** ${totalStats.totalPRs}
- **JIRA Tickets Processed:** ${totalStats.totalJiraTickets}
- **Release Note Entries Generated:** ${allRepoData.reduce((sum, repo) => sum + Object.values(repo.releaseNotesData || {}).flat().length, 0)}`);

    // Repository breakdown
    const repoStats = allRepoData
      .filter(repo => !repo.error)
      .map(repo => {
        const totalEntries = Object.values(repo.releaseNotesData || {}).flat().length;
        return {
          name: repo.repoConfig.name,
          prs: repo.prData.length,
          tickets: repo.jiraTickets.length,
          entries: totalEntries
        };
      })
      .sort((a, b) => b.prs - a.prs);

    if (repoStats.length > 0) {
      sections.push(`### Repository Breakdown

| Repository | Pull Requests | JIRA Tickets | Release Notes |
|------------|---------------|--------------|---------------|
${repoStats.map(repo => 
  `| ${repo.name} | ${repo.prs} | ${repo.tickets} | ${repo.entries} |`
).join('\n')}`);
    }

    // Category distribution
    const categoryTotals = {
      features: 0,
      improvements: 0,
      bugs: 0,
      other: 0
    };

    allRepoData.forEach(repo => {
      if (!repo.error && repo.releaseNotesData) {
        Object.entries(repo.releaseNotesData).forEach(([category, entries]) => {
          if (categoryTotals[category] !== undefined) {
            categoryTotals[category] += entries.length;
          }
        });
      }
    });

    const hasCategories = Object.values(categoryTotals).some(count => count > 0);
    
    if (hasCategories) {
      sections.push(`### Change Distribution

| Category | Count | Percentage |
|----------|-------|------------|
${Object.entries(categoryTotals)
  .filter(([_, count]) => count > 0)
  .map(([category, count]) => {
    const total = Object.values(categoryTotals).reduce((sum, c) => sum + c, 0);
    const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    const categoryName = this.getCategoryTitle(category);
    return `| ${categoryName} | ${count} | ${percentage}% |`;
  }).join('\n')}`);
    }

    sections.push(`---

*Generated on ${format(new Date(), 'MMMM do, yyyy \'at\' h:mm a')}*`);

    return sections.join('\n\n');
  }

  // Legacy single-repo method for backward compatibility
  generateMarkdown({ month, repo, releaseNotesData, prData, jiraTickets }) {
    const sections = [];
    
    // Header
    sections.push(this.generateHeader(month, repo));
    
    // Executive Summary
    sections.push(this.generateLegacyExecutiveSummary(releaseNotesData, prData));
    
    // Release notes by category
    sections.push(this.generateLegacyReleaseNotesSections(releaseNotesData));
    
    return sections.join('\n\n');
  }

  generateHeader(month, repo) {
    const [year, monthNum] = month.split('-');
    const monthName = format(new Date(year, monthNum - 1), 'MMMM yyyy');
    const productName = this.extractProductName(repo);
    
    return `# ${productName} - ${monthName} Release

**Release Date:** ${format(new Date(), 'MMMM do, yyyy')}

---`;
  }

  extractProductName(repo) {
    const repoName = repo.split('/')[1];
    return repoName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  generateLegacyExecutiveSummary(releaseNotesData, prData) {
    const totalChanges = Object.values(releaseNotesData).flat().length;
    
    if (totalChanges === 0) {
      return `## 🎯 This Month's Highlights

This month focused on behind-the-scenes improvements and maintenance to ensure the best possible experience for our users.`;
    }

    const hasFeatures = releaseNotesData.features?.length > 0;
    const hasBugFixes = releaseNotesData.bugs?.length > 0;
    const hasImprovements = releaseNotesData.improvements?.length > 0;

    let highlights = [];
    if (hasFeatures) highlights.push(`**${releaseNotesData.features.length}** new features and capabilities`);
    if (hasImprovements) highlights.push(`**${releaseNotesData.improvements.length}** enhancements to existing functionality`);
    if (hasBugFixes) highlights.push(`**${releaseNotesData.bugs.length}** fixes and stability improvements`);

    return `## 🎯 This Month's Highlights

We're excited to share ${highlights.join(', ')} designed to improve your experience and productivity.`;
  }

  generateLegacyReleaseNotesSections(releaseNotesData) {
    const sections = [];
    
    const categoryConfig = {
      features: {
        title: '✨ New Features & Capabilities',
        intro: 'Discover what\'s new and how it can help you:'
      },
      improvements: {
        title: '🚀 Enhancements & Improvements', 
        intro: 'We\'ve made these improvements based on your feedback:'
      },
      bugs: {
        title: '🔧 Fixes & Stability Improvements',
        intro: 'We\'ve resolved these issues to ensure a smoother experience:'
      },
      other: {
        title: '📝 Additional Updates',
        intro: 'Other improvements in this release:'
      }
    };

    const priorityOrder = ['features', 'improvements', 'bugs', 'other'];
    
    priorityOrder.forEach(category => {
      const entries = releaseNotesData[category];
      if (!entries || entries.length === 0) return;

      const config = categoryConfig[category];
      sections.push(`## ${config.title}

${config.intro}

${entries.map(entry => `- ${entry}`).join('\n')}`);
    });
    
    if (sections.length === 0) {
      sections.push(`## 🔧 Behind the Scenes

This month we focused on internal improvements and optimizations to enhance performance and reliability. While these changes aren't directly visible, they help ensure you have the best possible experience with our platform.`);
    }
    
    return sections.join('\n\n');
  }

  // Helper methods
  getCategoryConfig(category, repoConfig = null) {
    const defaultConfig = {
      features: {
        title: '✨ New Features & Capabilities',
        intro: 'New functionality and capabilities:'
      },
      improvements: {
        title: '🚀 Enhancements & Improvements', 
        intro: 'Performance and usability improvements:'
      },
      bugs: {
        title: '🔧 Fixes & Stability Improvements',
        intro: 'Issues resolved and stability improvements:'
      },
      other: {
        title: '📝 Additional Updates',
        intro: 'Other improvements and updates:'
      }
    };

    // Use custom category titles from repo config if available
    if (repoConfig?.categories?.[category]) {
      return {
        title: `${defaultConfig[category].title.split(' ')[0]} ${repoConfig.categories[category]}`,
        intro: defaultConfig[category].intro
      };
    }

    return defaultConfig[category] || defaultConfig.other;
  }

  getCategoryTitle(category) {
    const titles = {
      features: '✨ New Features',
      improvements: '🚀 Improvements',
      bugs: '🔧 Bug Fixes',
      other: '📝 Other Updates'
    };
    
    return titles[category] || titles.other;
  }

  createAnchor(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }
} 
