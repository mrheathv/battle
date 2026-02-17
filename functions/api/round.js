// POST /api/round — calls OpenAI, Claude, and Gemini in parallel and returns their responses
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatHistory(conversation) {
  return conversation
    .map((msg) => {
      const name =
        msg.ai === 'openai' ? 'GPT-4' : msg.ai === 'claude' ? 'Claude' : 'Gemini';
      return `[${name}]: "${msg.content}"`;
    })
    .join('\n\n');
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function getOpenAIResponse(topic, conversation, env) {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const model = env.OPENAI_MODEL || 'gpt-4o';
  const isInitial = conversation.length === 0;
  const history = formatHistory(conversation);

  const userPrompt = isInitial
    ? `The topic is "${topic}". Make your opening argument for why you, GPT-4 by OpenAI, know the most about this topic compared to Claude and Gemini. Be confident, specific, and a little cocky. 2-3 sentences max.`
    : `Here's the debate so far:\n\n${history}\n\nNow it's your turn, GPT-4. Respond to what Claude and Gemini said. Defend your position and push back on their claims with specific points. Be witty and sharp. 2-3 sentences max.`;

  const response = await client.chat.completions.create({
    model,
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

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function getClaudeResponse(topic, conversation, env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.CLAUDE_MODEL || 'claude-opus-4-5';
  const isInitial = conversation.length === 0;
  const history = formatHistory(conversation);

  const userPrompt = isInitial
    ? `The topic is "${topic}". Make your opening argument for why you, Claude by Anthropic, know the most about this topic compared to GPT-4 and Gemini. Be confident, articulate, and a little smug. 2-3 sentences max.`
    : `Here's the debate so far:\n\n${history}\n\nNow it's your turn, Claude. Respond to what GPT-4 and Gemini said. Defend your position, counter their arguments, and assert your superiority on "${topic}". Be sharp and incisive. 2-3 sentences max.`;

  const response = await client.messages.create({
    model,
    max_tokens: 250,
    system: `You are Claude by Anthropic, participating in a fun, spirited debate about which AI knows the most about "${topic}". Your rivals are GPT-4 (OpenAI) and Gemini (Google). Be confident, articulate, and entertainingly competitive. Reference your training approach, Constitutional AI, and Anthropic's research. Keep it short and punchy (2-3 sentences max).`,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text.trim();
}

// ── Gemini (direct REST — no SDK, avoids Node.js built-in dependencies) ───────

async function getGeminiResponse(topic, conversation, env) {
  const model = env.GEMINI_MODEL || 'gemini-1.5-pro';
  const apiKey = env.GEMINI_API_KEY;
  const isInitial = conversation.length === 0;
  const history = formatHistory(conversation);

  const systemText = `You are Gemini by Google, participating in a fun, spirited debate about which AI knows the most about "${topic}". Your rivals are GPT-4 (OpenAI) and Claude (Anthropic). Be confident, competitive, and entertainingly assertive. Reference Google's vast data, your multimodal training, real-time knowledge access, and Google's research leadership. Keep it short and punchy (2-3 sentences max).`;

  const userPrompt = isInitial
    ? `The topic is "${topic}". Make your opening argument for why you, Gemini by Google, know the most about this topic compared to GPT-4 and Claude. Be confident, highlight Google's vast knowledge and your multimodal capabilities, and be a little boastful. 2-3 sentences max.`
    : `Here's the debate so far:\n\n${history}\n\nNow it's your turn, Gemini. Respond to what GPT-4 and Claude said. Assert your superiority, counter their specific claims, and highlight what makes Google's AI superior on "${topic}". Be bold and specific. 2-3 sentences max.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemText }],
      },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 250,
        temperature: 0.9,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { topic, conversation } = body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return jsonResponse({ error: 'Topic is required' }, 400);
  }

  const cleanTopic = topic.trim().slice(0, 200);
  const cleanConversation = Array.isArray(conversation) ? conversation : [];

  const missingKeys = [];
  if (!env.OPENAI_API_KEY) missingKeys.push('OpenAI');
  if (!env.ANTHROPIC_API_KEY) missingKeys.push('Anthropic');
  if (!env.GEMINI_API_KEY) missingKeys.push('Gemini');

  if (missingKeys.length > 0) {
    return jsonResponse(
      {
        error: `Missing API keys for: ${missingKeys.join(', ')}. Configure them as Cloudflare secrets.`,
      },
      503,
    );
  }

  try {
    const [openaiContent, claudeContent, geminiContent] = await Promise.all([
      getOpenAIResponse(cleanTopic, cleanConversation, env),
      getClaudeResponse(cleanTopic, cleanConversation, env),
      getGeminiResponse(cleanTopic, cleanConversation, env),
    ]);

    return jsonResponse({
      responses: [
        { ai: 'openai', content: openaiContent },
        { ai: 'claude', content: claudeContent },
        { ai: 'gemini', content: geminiContent },
      ],
    });
  } catch (error) {
    let userMessage = 'Failed to get AI responses';
    if (error.status === 401 || error.message?.includes('API key')) {
      userMessage = 'Invalid API key. Check your Cloudflare secrets.';
    } else if (error.status === 429) {
      userMessage = 'Rate limit exceeded. Please wait a moment and try again.';
    } else if (error.status === 402) {
      userMessage = 'API quota exceeded. Check your billing settings.';
    }

    return jsonResponse({ error: userMessage, details: error.message }, 500);
  }
}
