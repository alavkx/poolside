import { format } from 'date-fns';

export class MarkdownGenerator {
  generateMarkdown({ month, repo, releaseNotesData, prData, jiraTickets }) {
    const sections = [];
    
    // Header
    sections.push(this.generateHeader(month, repo));
    
    // Executive Summary (customer-focused)
    sections.push(this.generateExecutiveSummary(releaseNotesData, prData));
    
    // Release notes by category (main content)
    sections.push(this.generateReleaseNotesSections(releaseNotesData));
    
    // Optional: What's Coming Next (placeholder for future use)
    // sections.push(this.generateUpcomingSection());
    
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
    // Extract a user-friendly product name from repo
    // This could be made configurable in the future
    const repoName = repo.split('/')[1];
    return repoName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  generateExecutiveSummary(releaseNotesData, prData) {
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

  generateReleaseNotesSections(releaseNotesData) {
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

    // Process in priority order
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

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }
} 
