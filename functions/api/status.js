// GET /api/status — reports which Cloudflare secrets are configured
export async function onRequestGet(context) {
  const { env } = context;

  return new Response(
    JSON.stringify({
      openai: !!env.OPENAI_API_KEY,
      claude: !!env.ANTHROPIC_API_KEY,
      gemini: !!env.GEMINI_API_KEY,
      deepseek: !!env.DEEPSEEK_API_KEY,
      models: {
        openai: env.OPENAI_MODEL || 'gpt-4o',
        claude: env.CLAUDE_MODEL || 'claude-opus-4-6',
        gemini: env.GEMINI_MODEL || 'gemini-2.0-flash',
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
