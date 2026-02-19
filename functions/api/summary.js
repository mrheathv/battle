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
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a sharp, witty AI debate judge scoring a knowledge battle about "${topic}" between GPT-4, Claude, and Gemini. You have zero bias toward any competitor.

Respond with ONLY valid JSON in this exact shape:
{
  "scores": { "openai": <integer 1-10>, "claude": <integer 1-10>, "gemini": <integer 1-10> },
  "verdict": "<2-3 punchy sentences declaring the winner. Be entertaining and specific — call out the best and worst moments. No dry academic language.>"
}`,
        },
        {
          role: 'user',
          content: `Here is the full debate transcript:\n\n${transcript}\n\nWho won this debate and why?`,
        },
      ],
      max_tokens: 400,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { scores: parsed.scores, verdict: parsed.verdict };
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

  let content = '[DeepSeek was unavailable to render a verdict]';
  let scores = null;
  try {
    const result = await getDeepSeekVerdict(cleanTopic, transcript, env);
    content = result.verdict;
    scores = result.scores;
  } catch {
    // fall through to defaults above
  }

  return jsonResponse({ summaries: [{ ai: 'deepseek', content, scores }] });
}
