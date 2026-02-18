// POST /api/summary — asks DeepSeek to act as an impartial judge and declare a winner
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

// ── DeepSeek ──────────────────────────────────────────────────────────────────

async function getDeepSeekVerdict(topic, transcript, env) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are an impartial AI debate judge evaluating a knowledge battle about "${topic}" between GPT-4, Claude, and Gemini. Analyze the arguments objectively and declare a clear winner. Be specific about who made the strongest, most accurate, and most compelling points. You have no bias toward any of the three competitors.`,
        },
        {
          role: 'user',
          content: `Here is the full debate transcript:\n\n${transcript}\n\nWho won this debate and why? Give a punchy 2–3 sentence verdict that clearly names the winner and explains what set them apart.`,
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
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

  let verdict;
  try {
    verdict = await getDeepSeekVerdict(cleanTopic, transcript, env);
  } catch {
    verdict = '[DeepSeek was unavailable to render a verdict]';
  }

  return jsonResponse({ summaries: [{ ai: 'deepseek', content: verdict }] });
}
