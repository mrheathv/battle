require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize API clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro';

/**
 * Format conversation history into a readable debate transcript
 */
function formatHistory(conversation) {
  return conversation
    .map((msg) => {
      const name =
        msg.ai === 'openai' ? 'GPT-4' : msg.ai === 'claude' ? 'Claude' : 'Gemini';
      return `[${name}]: "${msg.content}"`;
    })
    .join('\n\n');
}

/**
 * Get response from OpenAI GPT-4
 */
async function getOpenAIResponse(topic, conversation) {
  const isInitial = conversation.length === 0;
  const history = formatHistory(conversation);

  const userPrompt = isInitial
    ? `The topic is "${topic}". Make your opening argument for why you, GPT-4 by OpenAI, know the most about this topic compared to Claude and Gemini. Be confident, specific, and a little cocky. 2-3 sentences max.`
    : `Here's the debate so far:\n\n${history}\n\nNow it's your turn, GPT-4. Respond to what Claude and Gemini said. Defend your position and push back on their claims with specific points. Be witty and sharp. 2-3 sentences max.`;

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are GPT-4 by OpenAI, participating in a fun, spirited debate about which AI knows the most about "${topic}". Your rivals are Claude (Anthropic) and Gemini (Google). Be confident, witty, and entertainingly competitive. Reference your training data scale, OpenAI's research, and specific capabilities. Keep it short and punchy (2-3 sentences max).`,
      },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 250,
    temperature: 0.9,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Get response from Anthropic Claude
 */
async function getClaudeResponse(topic, conversation) {
  const isInitial = conversation.length === 0;
  const history = formatHistory(conversation);

  const userPrompt = isInitial
    ? `The topic is "${topic}". Make your opening argument for why you, Claude by Anthropic, know the most about this topic compared to GPT-4 and Gemini. Be confident, articulate, and a little smug. 2-3 sentences max.`
    : `Here's the debate so far:\n\n${history}\n\nNow it's your turn, Claude. Respond to what GPT-4 and Gemini said. Defend your position, counter their arguments, and assert your superiority on "${topic}". Be sharp and incisive. 2-3 sentences max.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 250,
    system: `You are Claude by Anthropic, participating in a fun, spirited debate about which AI knows the most about "${topic}". Your rivals are GPT-4 (OpenAI) and Gemini (Google). Be confident, articulate, and entertainingly competitive. Reference your training approach, Constitutional AI, and Anthropic's research. Keep it short and punchy (2-3 sentences max).`,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text.trim();
}

/**
 * Get response from Google Gemini
 */
async function getGeminiResponse(topic, conversation) {
  const isInitial = conversation.length === 0;
  const history = formatHistory(conversation);

  const userPrompt = isInitial
    ? `The topic is "${topic}". Make your opening argument for why you, Gemini by Google, know the most about this topic compared to GPT-4 and Claude. Be confident, highlight Google's vast knowledge and your multimodal capabilities, and be a little boastful. 2-3 sentences max.`
    : `Here's the debate so far:\n\n${history}\n\nNow it's your turn, Gemini. Respond to what GPT-4 and Claude said. Assert your superiority, counter their specific claims, and highlight what makes Google's AI superior on "${topic}". Be bold and specific. 2-3 sentences max.`;

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `You are Gemini by Google, participating in a fun, spirited debate about which AI knows the most about "${topic}". Your rivals are GPT-4 (OpenAI) and Claude (Anthropic). Be confident, competitive, and entertainingly assertive. Reference Google's vast data, your multimodal training, real-time knowledge access, and Google's research leadership. Keep it short and punchy (2-3 sentences max).`,
  });

  const result = await model.generateContent(userPrompt);
  return result.response.text().trim();
}

/**
 * Health check / API key status
 */
app.get('/api/status', (req, res) => {
  res.json({
    openai: !!process.env.OPENAI_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    models: {
      openai: OPENAI_MODEL,
      claude: CLAUDE_MODEL,
      gemini: GEMINI_MODEL,
    },
  });
});

/**
 * Main debate round endpoint
 * Body: { topic: string, conversation: Array<{ai: string, content: string}> }
 * Returns: { responses: Array<{ai: string, content: string}> }
 */
app.post('/api/round', async (req, res) => {
  const { topic, conversation } = req.body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const cleanTopic = topic.trim().slice(0, 200);
  const cleanConversation = Array.isArray(conversation) ? conversation : [];

  // Check which APIs are configured
  const missingKeys = [];
  if (!process.env.OPENAI_API_KEY) missingKeys.push('OpenAI');
  if (!process.env.ANTHROPIC_API_KEY) missingKeys.push('Anthropic');
  if (!process.env.GEMINI_API_KEY) missingKeys.push('Gemini');

  if (missingKeys.length > 0) {
    return res.status(503).json({
      error: `Missing API keys for: ${missingKeys.join(', ')}. Please configure your .env file.`,
    });
  }

  try {
    // Call all three AIs in parallel for speed
    const [openaiContent, claudeContent, geminiContent] = await Promise.all([
      getOpenAIResponse(cleanTopic, cleanConversation),
      getClaudeResponse(cleanTopic, cleanConversation),
      getGeminiResponse(cleanTopic, cleanConversation),
    ]);

    res.json({
      responses: [
        { ai: 'openai', content: openaiContent },
        { ai: 'claude', content: claudeContent },
        { ai: 'gemini', content: geminiContent },
      ],
    });
  } catch (error) {
    console.error('Error calling AI APIs:', error);

    // Provide helpful error messages for common issues
    let userMessage = 'Failed to get AI responses';
    if (error.status === 401 || error.message?.includes('API key')) {
      userMessage = 'Invalid API key. Please check your .env configuration.';
    } else if (error.status === 429) {
      userMessage = 'Rate limit exceeded. Please wait a moment and try again.';
    } else if (error.status === 402) {
      userMessage = 'API quota exceeded. Please check your billing settings.';
    }

    res.status(500).json({ error: userMessage, details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🥊 AI Battle server running on http://localhost:${PORT}`);
  console.log('─'.repeat(50));

  const keys = {
    'OpenAI    ': process.env.OPENAI_API_KEY,
    'Anthropic ': process.env.ANTHROPIC_API_KEY,
    'Gemini    ': process.env.GEMINI_API_KEY,
  };

  for (const [name, key] of Object.entries(keys)) {
    const status = key ? '✓ configured' : '✗ missing (set in .env)';
    console.log(`  ${name}: ${status}`);
  }
  console.log('─'.repeat(50) + '\n');
});
