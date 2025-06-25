import { format } from 'date-fns';

export class MarkdownGenerator {
  generateMarkdown({ month, repo, releaseNotesData, prData, jiraTickets }) {
    const sections = [];
    
    // Header
    sections.push(this.generateHeader(month, repo));
    
    // Summary
    sections.push(this.generateSummary(prData, jiraTickets));
    
    // Release notes by category
    sections.push(this.generateReleaseNotesSections(releaseNotesData));
    
    // Detailed PR list (appendix)
    sections.push(this.generateDetailedPRList(prData));
    
    // JIRA tickets reference (if any)
    if (jiraTickets.length > 0) {
      sections.push(this.generateJiraReference(jiraTickets));
    }
    
    return sections.join('\n\n');
  }

  generateHeader(month, repo) {
    const [year, monthNum] = month.split('-');
    const monthName = format(new Date(year, monthNum - 1), 'MMMM yyyy');
    
    return `# Release Notes - ${monthName}

**Repository:** ${repo}  
**Generated on:** ${format(new Date(), 'PPP')}

---`;
  }

  generateSummary(prData, jiraTickets) {
    const stats = this.calculateStats(prData);
    
    return `## 📊 Summary

This release includes **${prData.length} pull requests** merged during this period.

### Statistics
- **Total PRs:** ${prData.length}
- **Contributors:** ${stats.contributors}
- **Files changed:** ${stats.totalFiles}
- **Lines added:** ${stats.totalAdditions}
- **Lines removed:** ${stats.totalDeletions}
- **JIRA tickets linked:** ${jiraTickets.length}

### Top Contributors
${stats.topContributors.map(({ author, count }) => `- **${author}** (${count} PRs)`).join('\n')}`;
  }

  calculateStats(prData) {
    const contributors = new Set();
    const contributorCount = {};
    let totalFiles = 0;
    let totalAdditions = 0;
    let totalDeletions = 0;
    
    prData.forEach(pr => {
      contributors.add(pr.author);
      contributorCount[pr.author] = (contributorCount[pr.author] || 0) + 1;
      totalFiles += pr.changedFiles || 0;
      totalAdditions += pr.additions || 0;
      totalDeletions += pr.deletions || 0;
    });
    
    const topContributors = Object.entries(contributorCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([author, count]) => ({ author, count }));
    
    return {
      contributors: contributors.size,
      topContributors,
      totalFiles,
      totalAdditions,
      totalDeletions
    };
  }

  generateReleaseNotesSections(releaseNotesData) {
    const sections = [];
    
    const categoryTitles = {
      features: '✨ New Features',
      improvements: '🔧 Improvements',
      bugs: '🐛 Bug Fixes',
      other: '📝 Other Changes'
    };
    
    Object.entries(releaseNotesData).forEach(([category, entries]) => {
      if (entries.length === 0) return;
      
      sections.push(`## ${categoryTitles[category] || category}

${entries.map(entry => `- ${entry}`).join('\n')}`);
    });
    
    return sections.join('\n\n');
  }

  generateDetailedPRList(prData) {
    const sortedPRs = prData.sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));
    
    return `## 📋 Detailed Pull Request List

${sortedPRs.map(pr => {
  const mergedDate = format(new Date(pr.mergedAt), 'MMM dd');
  const labels = pr.labels.length > 0 ? ` \`${pr.labels.join('`, `')}\`` : '';
  
  return `### [#${pr.number}](${pr.url}) ${pr.title}
**Author:** @${pr.author} | **Merged:** ${mergedDate}${labels}

${pr.body ? this.truncateText(pr.body, 200) : '_No description provided_'}

**Changes:** +${pr.additions || 0} -${pr.deletions || 0} lines in ${pr.changedFiles || 0} files`;
}).join('\n\n')}`;
  }

  generateJiraReference(jiraTickets) {
    const groupedTickets = this.groupTicketsByType(jiraTickets);
    
    const sections = Object.entries(groupedTickets).map(([type, tickets]) => {
      return `### ${type}
${tickets.map(ticket => `- [${ticket.key}](${ticket.url}) - ${ticket.summary} (${ticket.status})`).join('\n')}`;
    });
    
    return `## 🎫 JIRA Tickets Reference

${sections.join('\n\n')}`;
  }

  groupTicketsByType(tickets) {
    return tickets.reduce((groups, ticket) => {
      const type = ticket.issueType;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(ticket);
      return groups;
    }, {});
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }
} 
