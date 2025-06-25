import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import ora from 'ora';
import chalk from 'chalk';

export class AIProcessor {
  constructor(apiKey, verbose = false) {
    this.verbose = verbose;
    
    if (!apiKey) {
      throw new Error('OpenAI API key is required. Run "npm start check-config" to verify your configuration.');
    }
    
    this.model = openai('gpt-4o-mini');
    
    if (this.verbose) {
      console.log(chalk.gray('🔧 [VERBOSE] AI Processor initialized'));
      console.log(chalk.gray(`🔧 [VERBOSE] Model: gpt-4o-mini`));
      console.log(chalk.gray(`🔧 [VERBOSE] API Key: ${apiKey.substring(0, 8)}...`));
    }
  }

  async generateReleaseNotes(prData, jiraTickets, month) {
    const spinner = ora('Generating release notes with AI...').start();
    
    if (this.verbose) {
      spinner.text = 'Generating release notes with AI... (verbose mode)';
      console.log(chalk.gray(`\n🔧 [VERBOSE] Starting AI generation for ${prData.length} PRs`));
      console.log(chalk.gray(`🔧 [VERBOSE] JIRA tickets available: ${jiraTickets.length}`));
      console.log(chalk.gray(`🔧 [VERBOSE] Target month: ${month}`));
    }
    
    try {
      const enhancedPRs = this.enhancePRsWithJiraData(prData, jiraTickets);
      
      if (this.verbose) {
        const withJira = enhancedPRs.filter(pr => pr.relatedTickets.length > 0);
        console.log(chalk.gray(`🔧 [VERBOSE] PRs enhanced with JIRA data: ${withJira.length}/${enhancedPRs.length}`));
      }
      
      const groupedChanges = this.groupChangesByType(enhancedPRs);
      
      if (this.verbose) {
        console.log(chalk.gray('🔧 [VERBOSE] Changes grouped by type:'));
        Object.entries(groupedChanges).forEach(([type, prs]) => {
          console.log(chalk.gray(`  • ${type}: ${prs.length} PRs`));
        });
      }
      
      const releaseNotesData = await this.processInBatches(groupedChanges, month);
      
      if (this.verbose) {
        const totalEntries = Object.values(releaseNotesData).flat().length;
        console.log(chalk.gray(`🔧 [VERBOSE] Generated ${totalEntries} release note entries`));
      }
      
      spinner.succeed('Release notes generated successfully');
      return releaseNotesData;
    } catch (error) {
      spinner.fail('Failed to generate release notes');
      
      if (this.verbose) {
        console.log(chalk.red('\n🔧 [VERBOSE] Detailed error information:'));
        console.log(chalk.red(`  Error type: ${error.constructor.name}`));
        console.log(chalk.red(`  Error message: ${error.message}`));
        
        if (error.status) {
          console.log(chalk.red(`  HTTP Status: ${error.status}`));
        }
        
        if (error.headers) {
          console.log(chalk.red('  Response headers:'));
          Object.entries(error.headers).forEach(([key, value]) => {
            console.log(chalk.red(`    ${key}: ${value}`));
          });
        }
        
        if (error.stack && this.verbose) {
          console.log(chalk.red('  Stack trace:'));
          console.log(chalk.red(error.stack));
        }
      }
      
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
      
      if (this.verbose && jiraKeys.length > 0) {
        console.log(chalk.gray(`🔧 [VERBOSE] PR #${pr.number}: Found JIRA keys: ${jiraKeys.join(', ')}`));
        if (relatedTickets.length !== jiraKeys.length) {
          const missing = jiraKeys.filter(key => !jiraMap.has(key));
          console.log(chalk.yellow(`  ⚠️  Missing JIRA tickets: ${missing.join(', ')}`));
        }
      }
      
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
      
      if (this.verbose) {
        console.log(chalk.gray(`🔧 [VERBOSE] PR #${pr.number} categorized as: ${category}`));
      }
    });

    return groups;
  }

  categorizeChange(pr) {
    const title = pr.title.toLowerCase();
    const labels = pr.labels.map(label => label.toLowerCase());
    const jiraTypes = pr.relatedTickets.map(ticket => ticket.issueType.toLowerCase());
    
    const allText = [title, ...labels, ...jiraTypes].join(' ');
    
    // More sophisticated categorization for customer-focused releases
    if (allText.includes('feature') || allText.includes('new') || allText.includes('story') || 
        allText.includes('add') || allText.includes('implement') || allText.includes('create')) {
      return 'features';
    }
    if (allText.includes('bug') || allText.includes('fix') || allText.includes('hotfix') || 
        allText.includes('resolve') || allText.includes('error') || allText.includes('issue')) {
      return 'bugs';
    }
    if (allText.includes('improvement') || allText.includes('enhance') || allText.includes('refactor') || 
        allText.includes('optimize') || allText.includes('performance') || allText.includes('update') ||
        allText.includes('upgrade') || allText.includes('better')) {
      return 'improvements';
    }
    
    return 'other';
  }

  async processInBatches(groupedChanges, month) {
    const sections = {};
    let totalAPIRequests = 0;
    
    for (const [category, prs] of Object.entries(groupedChanges)) {
      if (prs.length === 0) continue;
      
      if (this.verbose) {
        console.log(chalk.gray(`\n🔧 [VERBOSE] Processing category: ${category} (${prs.length} PRs)`));
      }
      
      const batches = this.createBatches(prs, 5); // Process 5 PRs at a time
      const processedBatches = [];
      
      if (this.verbose) {
        console.log(chalk.gray(`🔧 [VERBOSE] Split into ${batches.length} batches`));
      }
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        if (this.verbose) {
          console.log(chalk.gray(`🔧 [VERBOSE] Processing batch ${i + 1}/${batches.length} (${batch.length} PRs)`));
        }
        
        try {
          const batchResult = await this.processBatch(batch, category);
          processedBatches.push(batchResult);
          totalAPIRequests++;
          
          if (this.verbose) {
            console.log(chalk.gray(`🔧 [VERBOSE] Batch ${i + 1} completed: ${batchResult.length} entries generated`));
          }
          
          // Add small delay between requests to be respectful
          if (i < batches.length - 1) {
            if (this.verbose) {
              console.log(chalk.gray('🔧 [VERBOSE] Waiting 100ms before next request...'));
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          if (this.verbose) {
            console.log(chalk.red(`🔧 [VERBOSE] Batch ${i + 1} failed: ${error.message}`));
          }
          throw error;
        }
      }
      
      sections[category] = processedBatches.flat();
    }
    
    if (this.verbose) {
      console.log(chalk.gray(`\n🔧 [VERBOSE] Total API requests made: ${totalAPIRequests}`));
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
    
    if (this.verbose) {
      console.log(chalk.gray('🔧 [VERBOSE] OpenAI API Request Details:'));
      console.log(chalk.gray(`  Model: gpt-4o-mini`));
      console.log(chalk.gray(`  Temperature: 0.3`));
      console.log(chalk.gray(`  Max Tokens: 1000`));
      console.log(chalk.gray(`  Prompt length: ${prompt.length} characters`));
      console.log(chalk.gray(`  PRs in batch: ${prBatch.map(pr => `#${pr.number}`).join(', ')}`));
    }
    
    const startTime = Date.now();
    
    try {
      const { text, usage, warnings } = await generateText({
        model: this.model,
        prompt,
        temperature: 0.3,
        maxTokens: 1000
      });
      
      const duration = Date.now() - startTime;
      
      if (this.verbose) {
        console.log(chalk.gray('🔧 [VERBOSE] OpenAI API Response:'));
        console.log(chalk.gray(`  Duration: ${duration}ms`));
        console.log(chalk.gray(`  Response length: ${text.length} characters`));
        
        if (usage) {
          console.log(chalk.gray('  Token usage:'));
          if (usage.promptTokens) console.log(chalk.gray(`    Prompt tokens: ${usage.promptTokens}`));
          if (usage.completionTokens) console.log(chalk.gray(`    Completion tokens: ${usage.completionTokens}`));
          if (usage.totalTokens) console.log(chalk.gray(`    Total tokens: ${usage.totalTokens}`));
        }
        
        if (warnings && warnings.length > 0) {
          console.log(chalk.yellow('  Warnings:'));
          warnings.forEach(warning => {
            console.log(chalk.yellow(`    ${warning}`));
          });
        }
        
        console.log(chalk.gray('  Raw response preview:'));
        console.log(chalk.gray(`    ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`));
      }
      
      const parsed = this.parseAIResponse(text);
      
      if (this.verbose) {
        console.log(chalk.gray(`🔧 [VERBOSE] Parsed ${parsed.length} release note entries from response`));
      }
      
      return parsed;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (this.verbose) {
        console.log(chalk.red('🔧 [VERBOSE] OpenAI API Error:'));
        console.log(chalk.red(`  Duration before error: ${duration}ms`));
        console.log(chalk.red(`  Error type: ${error.constructor.name}`));
        console.log(chalk.red(`  Error message: ${error.message}`));
        
        if (error.code) {
          console.log(chalk.red(`  Error code: ${error.code}`));
        }
        
        if (error.status) {
          console.log(chalk.red(`  HTTP status: ${error.status}`));
        }
        
        if (error.response) {
          console.log(chalk.red('  Response data:'));
          console.log(chalk.red(`    ${JSON.stringify(error.response, null, 2)}`));
        }
        
        // Check for specific quota error
        if (error.message.includes('quota') || error.message.includes('billing')) {
          console.log(chalk.yellow('\n💡 [VERBOSE] This appears to be a quota/billing issue:'));
          console.log(chalk.yellow('   • Check your OpenAI account billing: https://platform.openai.com/account/billing'));
          console.log(chalk.yellow('   • Verify your usage limits: https://platform.openai.com/account/usage'));
          console.log(chalk.yellow('   • Consider upgrading your plan if needed'));
        }
      }
      
      throw error;
    }
  }

  buildPrompt(prBatch, category) {
    const prDescriptions = prBatch.map(pr => {
      const jiraContext = pr.relatedTickets.length > 0 
        ? `\nRelated tickets: ${pr.relatedTickets.map(t => `${t.key}: ${t.summary}`).join(', ')}`
        : '';
      
      return `Change: ${pr.title}
${pr.body.substring(0, 300)}${pr.body.length > 300 ? '...' : ''}${jiraContext}
Labels: ${pr.labels.join(', ')}`;
    }).join('\n\n');

    const categoryContext = {
      features: "new functionality and capabilities",
      improvements: "enhancements and optimizations", 
      bugs: "fixes and stability improvements",
      other: "general updates"
    };

    const prompt = `You are writing customer-facing release notes for a SaaS product. Transform the following development changes into customer-focused release note entries that highlight the value and benefits to users.

Category: ${categoryContext[category] || category}

CRITICAL GUIDELINES:
- Write for customers/end-users, NOT developers
- Focus on user benefits and product value
- Use simple, clear language that non-technical users understand
- EXCLUDE purely internal/infrastructure changes (CI/CD, build scripts, internal refactoring, developer tooling, etc.)
- EXCLUDE changes that don't provide direct user value
- Combine similar changes into single, coherent entries
- Start with action verbs that show value: "Enhanced", "Streamlined", "Added", "Improved", "Fixed"
- Explain the "what" and "why" from a user perspective
- If a change has no customer-facing impact, do not include it

Development Changes:
${prDescriptions}

Generate customer-focused release note entries. Only include changes that provide direct value to users. Format as:
- [Customer-focused description highlighting user benefit]
- [Another entry focusing on user value]

Release note entries:`;

    if (this.verbose) {
      console.log(chalk.gray('\n🔧 [VERBOSE] Generated prompt:'));
      console.log(chalk.gray('=' .repeat(50)));
      console.log(chalk.gray(prompt));
      console.log(chalk.gray('=' .repeat(50)));
    }

    return prompt;
  }

  parseAIResponse(response) {
    const parsed = response
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim().substring(1).trim())
      .filter(line => line.length > 0);
    
    if (this.verbose) {
      console.log(chalk.gray('🔧 [VERBOSE] Parsing AI response:'));
      console.log(chalk.gray(`  Found ${parsed.length} bullet points`));
      parsed.forEach((entry, i) => {
        console.log(chalk.gray(`  ${i + 1}. ${entry.substring(0, 80)}${entry.length > 80 ? '...' : ''}`));
      });
    }
    
    return parsed;
  }
} 
