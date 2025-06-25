import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import ora from 'ora';

export class AIProcessor {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
    }
    this.model = openai('gpt-4-turbo');
  }

  async generateReleaseNotes(prData, jiraTickets, month) {
    const spinner = ora('Generating release notes with AI...').start();
    
    try {
      const enhancedPRs = this.enhancePRsWithJiraData(prData, jiraTickets);
      const groupedChanges = this.groupChangesByType(enhancedPRs);
      
      const releaseNotesData = await this.processInBatches(groupedChanges, month);
      
      spinner.succeed('Release notes generated successfully');
      return releaseNotesData;
    } catch (error) {
      spinner.fail('Failed to generate release notes');
      throw error;
    }
  }

  enhancePRsWithJiraData(prData, jiraTickets) {
    const jiraMap = new Map(jiraTickets.map(ticket => [ticket.key, ticket]));
    
    return prData.map(pr => {
      const jiraKeys = this.extractJiraKeys(pr);
      const relatedTickets = jiraKeys
        .map(key => jiraMap.get(key))
        .filter(Boolean);
      
      return {
        ...pr,
        jiraKeys,
        relatedTickets
      };
    });
  }

  extractJiraKeys(pr) {
    const jiraKeyRegex = /[A-Z][A-Z0-9]+-\d+/g;
    const text = `${pr.title} ${pr.body}`;
    const matches = text.match(jiraKeyRegex);
    return matches ? [...new Set(matches)] : [];
  }

  groupChangesByType(enhancedPRs) {
    const groups = {
      features: [],
      bugs: [],
      improvements: [],
      other: []
    };

    enhancedPRs.forEach(pr => {
      const category = this.categorizeChange(pr);
      groups[category].push(pr);
    });

    return groups;
  }

  categorizeChange(pr) {
    const title = pr.title.toLowerCase();
    const labels = pr.labels.map(label => label.toLowerCase());
    const jiraTypes = pr.relatedTickets.map(ticket => ticket.issueType.toLowerCase());
    
    const allText = [title, ...labels, ...jiraTypes].join(' ');
    
    if (allText.includes('feature') || allText.includes('new') || allText.includes('story')) {
      return 'features';
    }
    if (allText.includes('bug') || allText.includes('fix') || allText.includes('hotfix')) {
      return 'bugs';
    }
    if (allText.includes('improvement') || allText.includes('enhance') || allText.includes('refactor')) {
      return 'improvements';
    }
    
    return 'other';
  }

  async processInBatches(groupedChanges, month) {
    const sections = {};
    
    for (const [category, prs] of Object.entries(groupedChanges)) {
      if (prs.length === 0) continue;
      
      const batches = this.createBatches(prs, 5); // Process 5 PRs at a time
      const processedBatches = [];
      
      for (const batch of batches) {
        const batchResult = await this.processBatch(batch, category);
        processedBatches.push(batchResult);
      }
      
      sections[category] = processedBatches.flat();
    }
    
    return sections;
  }

  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  async processBatch(prBatch, category) {
    const prompt = this.buildPrompt(prBatch, category);
    
    const { text } = await generateText({
      model: this.model,
      prompt,
      temperature: 0.3,
      maxTokens: 1000
    });
    
    return this.parseAIResponse(text);
  }

  buildPrompt(prBatch, category) {
    const prDescriptions = prBatch.map(pr => {
      const jiraContext = pr.relatedTickets.length > 0 
        ? `\nRelated JIRA tickets: ${pr.relatedTickets.map(t => `${t.key}: ${t.summary}`).join(', ')}`
        : '';
      
      return `PR #${pr.number}: ${pr.title}
${pr.body.substring(0, 200)}${pr.body.length > 200 ? '...' : ''}${jiraContext}
Author: ${pr.author}
Labels: ${pr.labels.join(', ')}`;
    }).join('\n\n');

    return `You are generating release notes for a software project. Convert the following pull requests into concise, user-friendly release note entries.

Category: ${category}

Guidelines:
- Focus on user-facing changes and benefits
- Use clear, non-technical language where possible
- Combine related changes into single entries when appropriate
- Start each entry with an action verb (Added, Fixed, Improved, etc.)
- Keep entries concise but informative
- Include relevant context from JIRA tickets when available

Pull Requests:
${prDescriptions}

Generate release note entries in the following format:
- [Entry description]
- [Entry description]
- [Entry description]

Release note entries:`;
  }

  parseAIResponse(response) {
    return response
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().substring(1).trim())
      .filter(line => line.length > 0);
  }
} 
