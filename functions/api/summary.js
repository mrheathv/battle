// POST /api/summary — asks each AI for a TLDR verdict on who won the debate
// Uses direct REST API calls (no npm SDKs) for Cloudflare Workers compatibility.

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatTranscript(conversation) {
  return conversation
    .map((msg) => {
      const name =
        msg.ai === 'openai' ? 'GPT-4' : msg.ai === 'claude' ? 'Claude' : 'Gemini';
      return `[${name}]: "${msg.content}"`;
    })
    .join('\n\n');
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function getOpenAISummary(topic, transcript, env) {
  const model = env.OPENAI_MODEL || 'gpt-4o';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a witty debate judge summarizing an AI knowledge battle about "${topic}". You have a slight but transparent bias toward GPT-4. Give a punchy 2-sentence TLDR of the debate and declare a winner. Be entertaining and specific about who made the best points.`,
        },
        {
          role: 'user',
          content: `Here is the full debate transcript:\n\n${transcript}\n\nGive your TLDR verdict: who argued best and who wins?`,
        },
      ],
      max_tokens: 120,
      temperature: 0.85,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function getClaudeSummary(topic, transcript, env) {
  const model = env.CLAUDE_MODEL || 'claude-opus-4-6';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      system: `You are a witty debate judge summarizing an AI knowledge battle about "${topic}". You have a slight but transparent bias toward Claude. Give a punchy 2-sentence TLDR of the debate and declare a winner. Be entertaining and specific about who made the best points.`,
      messages: [
        {
          role: 'user',
          content: `Here is the full debate transcript:\n\n${transcript}\n\nGive your TLDR verdict: who argued best and who wins?`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content[0].text.trim();
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async function getGeminiSummary(topic, transcript, env) {
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const apiKey = env.GEMINI_API_KEY;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: `You are a witty debate judge summarizing an AI knowledge battle about "${topic}". You have a slight but transparent bias toward Gemini. Give a punchy 2-sentence TLDR of the debate and declare a winner. Be entertaining and specific about who made the best points.`,
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Here is the full debate transcript:\n\n${transcript}\n\nGive your TLDR verdict: who argued best and who wins?`,
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 120, temperature: 0.85 },
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

  if (!Array.isArray(conversation) || conversation.length === 0) {
    return jsonResponse({ error: 'Conversation is required' }, 400);
  }

  const cleanTopic = topic.trim().slice(0, 200);
  const transcript = formatTranscript(conversation);

  const [openaiResult, claudeResult, geminiResult] = await Promise.allSettled([
    getOpenAISummary(cleanTopic, transcript, env),
    getClaudeSummary(cleanTopic, transcript, env),
    getGeminiSummary(cleanTopic, transcript, env),
  ]);

  const summaries = [
    {
      ai: 'openai',
      content:
        openaiResult.status === 'fulfilled'
          ? openaiResult.value
          : `[Could not reach GPT-4 for a verdict]`,
    },
    {
      ai: 'claude',
      content:
        claudeResult.status === 'fulfilled'
          ? claudeResult.value
          : `[Could not reach Claude for a verdict]`,
    },
    {
      ai: 'gemini',
      content:
        geminiResult.status === 'fulfilled'
          ? geminiResult.value
          : `[Could not reach Gemini for a verdict]`,
    },
  ];

  return jsonResponse({ summaries });
}
