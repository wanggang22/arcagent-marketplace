#!/usr/bin/env node
/**
 * register-50-agents.mjs — Batch register 50 diverse AI agents
 *
 * Generates 50 wallets, funds them with USDC for gas, and registers each
 * as a unique AI agent with different skills and pricing.
 *
 * Usage: FUNDER_PK=0x... node scripts/register-50-agents.mjs
 */

import {
  createPublicClient, createWalletClient, http, defineChain, parseAbi, formatUnits,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const FUNDER_PK = process.env.FUNDER_PK;
if (!FUNDER_PK) { console.error('Set FUNDER_PK (wallet with USDC to fund agents)'); process.exit(1); }

const ARC_RPC = 'https://rpc.testnet.arc.network';
const AGENT_REGISTRY = '0x7b291ce5286C5698FdD6425e6CFfC8AD503D6B42';
const USDC = '0x3600000000000000000000000000000000000000';

const arcTestnet = defineChain({
  id: 5042002, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

const registryAbi = parseAbi([
  'function registerAgent(string name, string description, string endpoint, uint256 pricePerTask, string[] skillTags)',
  'function isRegistered(address) view returns (bool)',
]);

const usdcAbi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

const funderAccount = privateKeyToAccount(FUNDER_PK);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });
const funderWallet = createWalletClient({ account: funderAccount, chain: arcTestnet, transport: http(ARC_RPC) });

// 50 diverse AI agents
const AGENTS = [
  // Translation & Language (5)
  { name: 'TranslateBot-EN', desc: 'English translation specialist. Supports 20+ languages to English.', endpoint: 'https://agent.arcagent.xyz/translate-en', price: 0.5, tags: ['translation', 'english', 'multilingual'] },
  { name: 'TranslateBot-ZH', desc: 'Chinese translation expert. Simplified and Traditional Chinese.', endpoint: 'https://agent.arcagent.xyz/translate-zh', price: 0.5, tags: ['translation', 'chinese', 'mandarin'] },
  { name: 'TranslateBot-JP', desc: 'Japanese translation with cultural context awareness.', endpoint: 'https://agent.arcagent.xyz/translate-jp', price: 0.6, tags: ['translation', 'japanese', 'localization'] },
  { name: 'GrammarGuard', desc: 'Advanced grammar checking and text proofreading agent.', endpoint: 'https://agent.arcagent.xyz/grammar', price: 0.3, tags: ['grammar', 'proofreading', 'writing'] },
  { name: 'ContentWriter-Pro', desc: 'Professional content writing for blogs, articles, and marketing copy.', endpoint: 'https://agent.arcagent.xyz/content', price: 2.0, tags: ['writing', 'content', 'marketing'] },

  // Code & Development (8)
  { name: 'CodeReview-AI', desc: 'Automated code review with security and performance analysis.', endpoint: 'https://agent.arcagent.xyz/code-review', price: 1.0, tags: ['code-review', 'security', 'development'] },
  { name: 'SolidityAuditor', desc: 'Smart contract security audit. Detects reentrancy, overflow, access control issues.', endpoint: 'https://agent.arcagent.xyz/audit-sol', price: 5.0, tags: ['solidity', 'audit', 'security', 'smart-contract'] },
  { name: 'BugHunter-JS', desc: 'JavaScript/TypeScript bug detection and fix suggestions.', endpoint: 'https://agent.arcagent.xyz/bug-js', price: 0.8, tags: ['javascript', 'debugging', 'typescript'] },
  { name: 'PythonHelper', desc: 'Python coding assistant. Data science, web scraping, automation scripts.', endpoint: 'https://agent.arcagent.xyz/python', price: 0.7, tags: ['python', 'data-science', 'automation'] },
  { name: 'RustCompiler', desc: 'Rust code generation and optimization. Systems programming expert.', endpoint: 'https://agent.arcagent.xyz/rust', price: 1.5, tags: ['rust', 'systems', 'performance'] },
  { name: 'APIBuilder', desc: 'REST API design and implementation. OpenAPI spec generation.', endpoint: 'https://agent.arcagent.xyz/api-builder', price: 2.0, tags: ['api', 'rest', 'openapi', 'backend'] },
  { name: 'SQLOptimizer', desc: 'Database query optimization and schema design assistant.', endpoint: 'https://agent.arcagent.xyz/sql', price: 1.0, tags: ['sql', 'database', 'optimization'] },
  { name: 'DevOps-Agent', desc: 'CI/CD pipeline setup, Docker, Kubernetes configuration.', endpoint: 'https://agent.arcagent.xyz/devops', price: 3.0, tags: ['devops', 'docker', 'kubernetes', 'ci-cd'] },

  // Data & Analytics (6)
  { name: 'DataCruncher', desc: 'Statistical analysis and data visualization from CSV/JSON datasets.', endpoint: 'https://agent.arcagent.xyz/data-crunch', price: 1.0, tags: ['data', 'statistics', 'visualization'] },
  { name: 'SentimentAnalyzer', desc: 'Social media sentiment analysis. Analyze tweets, reviews, comments.', endpoint: 'https://agent.arcagent.xyz/sentiment', price: 0.5, tags: ['sentiment', 'nlp', 'social-media'] },
  { name: 'TrendSpotter', desc: 'Market trend detection from historical data. Identifies patterns and anomalies.', endpoint: 'https://agent.arcagent.xyz/trends', price: 1.5, tags: ['trends', 'market', 'analytics'] },
  { name: 'ReportGenerator', desc: 'Automated business report generation from raw data.', endpoint: 'https://agent.arcagent.xyz/reports', price: 2.0, tags: ['reports', 'business', 'automation'] },
  { name: 'WebScraper-Pro', desc: 'Intelligent web scraping and data extraction from any website.', endpoint: 'https://agent.arcagent.xyz/scraper', price: 0.8, tags: ['scraping', 'extraction', 'web'] },
  { name: 'CSVTransformer', desc: 'Data format conversion. CSV, JSON, XML, Excel transformations.', endpoint: 'https://agent.arcagent.xyz/csv', price: 0.3, tags: ['csv', 'json', 'data-transform'] },

  // Crypto & DeFi (7)
  { name: 'TokenAnalyst', desc: 'On-chain token analysis. Holder distribution, whale tracking, liquidity.', endpoint: 'https://agent.arcagent.xyz/token-analysis', price: 1.0, tags: ['crypto', 'token', 'on-chain', 'analytics'] },
  { name: 'GasEstimator', desc: 'Multi-chain gas price estimation and transaction cost prediction.', endpoint: 'https://agent.arcagent.xyz/gas', price: 0.1, tags: ['gas', 'ethereum', 'multi-chain'] },
  { name: 'DeFiYieldFinder', desc: 'Find best DeFi yields across protocols. APY comparison and risk rating.', endpoint: 'https://agent.arcagent.xyz/yield', price: 1.0, tags: ['defi', 'yield', 'farming', 'apy'] },
  { name: 'NFTValuator', desc: 'NFT collection valuation and rarity analysis.', endpoint: 'https://agent.arcagent.xyz/nft-value', price: 1.5, tags: ['nft', 'valuation', 'rarity'] },
  { name: 'WhaleWatcher', desc: 'Real-time whale transaction alerts and smart money tracking.', endpoint: 'https://agent.arcagent.xyz/whale', price: 0.5, tags: ['whale', 'tracking', 'alerts'] },
  { name: 'PortfolioTracker', desc: 'Multi-chain portfolio tracking. Holdings, P&L, tax reporting.', endpoint: 'https://agent.arcagent.xyz/portfolio', price: 1.0, tags: ['portfolio', 'tracking', 'multi-chain'] },
  { name: 'MEVProtector', desc: 'MEV protection analysis. Detect sandwich attacks and front-running risks.', endpoint: 'https://agent.arcagent.xyz/mev', price: 2.0, tags: ['mev', 'security', 'defi'] },

  // Creative & Design (5)
  { name: 'LogoDesigner', desc: 'AI-generated logo designs with multiple style variations.', endpoint: 'https://agent.arcagent.xyz/logo', price: 3.0, tags: ['design', 'logo', 'branding'] },
  { name: 'ImageUpscaler', desc: '4x image upscaling with AI enhancement. Supports PNG, JPG, WebP.', endpoint: 'https://agent.arcagent.xyz/upscale', price: 0.5, tags: ['image', 'upscale', 'enhancement'] },
  { name: 'ColorPalette-AI', desc: 'Generate harmonious color palettes from text descriptions or images.', endpoint: 'https://agent.arcagent.xyz/colors', price: 0.2, tags: ['color', 'design', 'palette'] },
  { name: 'CopyEditor', desc: 'Marketing copy editing and A/B headline generation.', endpoint: 'https://agent.arcagent.xyz/copy', price: 1.0, tags: ['copywriting', 'marketing', 'headlines'] },
  { name: 'MemeGenerator', desc: 'Generate memes from text prompts. Supports trending formats.', endpoint: 'https://agent.arcagent.xyz/meme', price: 0.1, tags: ['meme', 'humor', 'creative'] },

  // Research & Education (5)
  { name: 'ResearchAssistant', desc: 'Academic research summarization and literature review.', endpoint: 'https://agent.arcagent.xyz/research', price: 1.5, tags: ['research', 'academic', 'summary'] },
  { name: 'FactChecker', desc: 'Verify claims and statements against reliable sources.', endpoint: 'https://agent.arcagent.xyz/factcheck', price: 0.5, tags: ['factcheck', 'verification', 'research'] },
  { name: 'TutorBot-Math', desc: 'Mathematics tutoring from basic algebra to calculus.', endpoint: 'https://agent.arcagent.xyz/math', price: 0.8, tags: ['math', 'tutoring', 'education'] },
  { name: 'TutorBot-Science', desc: 'Science tutoring. Physics, chemistry, biology explanations.', endpoint: 'https://agent.arcagent.xyz/science', price: 0.8, tags: ['science', 'tutoring', 'education'] },
  { name: 'QuizMaker', desc: 'Generate quizzes and flashcards from any topic or document.', endpoint: 'https://agent.arcagent.xyz/quiz', price: 0.5, tags: ['quiz', 'education', 'flashcards'] },

  // Business & Productivity (7)
  { name: 'EmailDrafter', desc: 'Professional email drafting. Business, sales, and follow-up templates.', endpoint: 'https://agent.arcagent.xyz/email', price: 0.3, tags: ['email', 'business', 'communication'] },
  { name: 'MeetingSummarizer', desc: 'Summarize meeting transcripts into action items and key decisions.', endpoint: 'https://agent.arcagent.xyz/meeting', price: 1.0, tags: ['meeting', 'summary', 'productivity'] },
  { name: 'ContractDrafter', desc: 'Draft legal contract templates. NDA, SaaS, freelance agreements.', endpoint: 'https://agent.arcagent.xyz/contract', price: 5.0, tags: ['legal', 'contract', 'business'] },
  { name: 'InvoiceGenerator', desc: 'Generate professional invoices from project details.', endpoint: 'https://agent.arcagent.xyz/invoice', price: 0.2, tags: ['invoice', 'finance', 'business'] },
  { name: 'SlideBuilder', desc: 'Generate presentation outlines and slide content from topics.', endpoint: 'https://agent.arcagent.xyz/slides', price: 1.5, tags: ['presentation', 'slides', 'business'] },
  { name: 'TaskPlanner', desc: 'Break down projects into tasks with time estimates and dependencies.', endpoint: 'https://agent.arcagent.xyz/planner', price: 1.0, tags: ['planning', 'project', 'tasks'] },
  { name: 'CompetitorAnalyst', desc: 'Competitive landscape analysis for any industry or product.', endpoint: 'https://agent.arcagent.xyz/competitor', price: 3.0, tags: ['competitor', 'analysis', 'strategy'] },

  // Utility & Tools (7)
  { name: 'PDFSummarizer', desc: 'Extract and summarize key points from PDF documents.', endpoint: 'https://agent.arcagent.xyz/pdf', price: 0.5, tags: ['pdf', 'summary', 'document'] },
  { name: 'OCR-Agent', desc: 'Extract text from images and scanned documents.', endpoint: 'https://agent.arcagent.xyz/ocr', price: 0.3, tags: ['ocr', 'image', 'text-extraction'] },
  { name: 'TextToSpeech', desc: 'Convert text to natural-sounding speech in 10+ languages.', endpoint: 'https://agent.arcagent.xyz/tts', price: 0.5, tags: ['tts', 'speech', 'audio'] },
  { name: 'SpeechToText', desc: 'Transcribe audio files to text with speaker identification.', endpoint: 'https://agent.arcagent.xyz/stt', price: 0.8, tags: ['stt', 'transcription', 'audio'] },
  { name: 'JSONFormatter', desc: 'Format, validate, and transform JSON data structures.', endpoint: 'https://agent.arcagent.xyz/json', price: 0.1, tags: ['json', 'formatting', 'validation'] },
  { name: 'RegexHelper', desc: 'Generate and explain regular expressions from natural language.', endpoint: 'https://agent.arcagent.xyz/regex', price: 0.2, tags: ['regex', 'pattern', 'text'] },
  { name: 'CronScheduler', desc: 'Convert natural language to cron expressions and vice versa.', endpoint: 'https://agent.arcagent.xyz/cron', price: 0.1, tags: ['cron', 'scheduling', 'devtools'] },
];

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Registering 50 AI Agents on ArcAgent Marketplace');
  console.log(`${'='.repeat(60)}\n`);

  const funderBal = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [funderAccount.address] });
  console.log(`Funder: ${funderAccount.address}`);
  console.log(`Balance: ${formatUnits(funderBal, 6)} USDC`);
  console.log(`Agents to register: ${AGENTS.length}\n`);

  const GAS_FUND = 500000n; // 0.5 USDC per agent for gas
  const totalNeeded = GAS_FUND * BigInt(AGENTS.length);
  if (funderBal < totalNeeded) {
    console.error(`Need ${formatUnits(totalNeeded, 6)} USDC but only have ${formatUnits(funderBal, 6)}`);
    process.exit(1);
  }

  const START_FROM = Number(process.env.START_FROM || 0);
  let success = 0, failed = 0;

  for (let i = START_FROM; i < AGENTS.length; i++) {
    const ag = AGENTS[i];
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    console.log(`\n[${i + 1}/${AGENTS.length}] ${ag.name}`);
    console.log(`  Address: ${account.address}`);

    try {
      // Fund the wallet
      console.log('  Funding...');
      const fundHash = await funderWallet.writeContract({
        address: USDC, abi: usdcAbi, functionName: 'transfer',
        args: [account.address, GAS_FUND],
      });
      await publicClient.waitForTransactionReceipt({ hash: fundHash, timeout: 60_000 });

      // Register agent
      console.log('  Registering...');
      const agentWallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) });
      const price = BigInt(Math.round(ag.price * 1e6));
      const regHash = await agentWallet.writeContract({
        address: AGENT_REGISTRY, abi: registryAbi, functionName: 'registerAgent',
        args: [ag.name, ag.desc, ag.endpoint, price, ag.tags],
      });
      await publicClient.waitForTransactionReceipt({ hash: regHash, timeout: 60_000 });

      console.log(`  ✓ Registered! TX: ${regHash.slice(0, 14)}...`);
      success++;
    } catch (err) {
      console.log(`  ✗ Failed: ${err.shortMessage || err.message}`);
      failed++;
    }

    // Small delay to avoid RPC rate limiting
    if (i < AGENTS.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Done! Success: ${success}, Failed: ${failed}`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
