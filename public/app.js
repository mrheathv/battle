/* ── AI Battle: Frontend Logic ── */

const MAX_RESPONSES = 21;
const BETWEEN_ROUND_DELAY = 6000; // ms between auto-advancing to next round
const MESSAGE_DELAY = 600;        // ms between messages appearing in same round

const AI_CONFIG = {
  openai: {
    name: 'GPT-4',
    short: 'GPT',
    color: '#10a37f',
  },
  claude: {
    name: 'Claude',
    short: 'CL',
    color: '#d97706',
  },
  gemini: {
    name: 'Gemini',
    short: 'GEM',
    color: '#4285f4',
  },
  deepseek: {
    name: 'DeepSeek',
    short: 'DS',
    color: '#5e5ce6',
  },
};

// ── State ──
let topic = '';
let conversation = [];  // { ai, content }[]
let responseCount = 0;
let roundNumber = 0;
let sessionEnded = false;

// ── Utility ──
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  const el = document.createElement('div');
  el.appendChild(document.createTextNode(str));
  return el.innerHTML;
}

// ── Screen Management ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Status Bar ──
function setStatus(text, loading = false) {
  const bar = document.getElementById('status-bar');
  const textEl = document.getElementById('status-text');

  if (!text) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  textEl.textContent = text;

  const dots = bar.querySelector('.typing-indicator');
  dots.style.display = loading ? 'flex' : 'none';
}

// ── Progress ──
function updateProgress() {
  const pct = Math.min((responseCount / MAX_RESPONSES) * 100, 100);
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('progress-text').textContent = `${responseCount} / ${MAX_RESPONSES}`;
}

// ── Round Divider ──
function addRoundDivider(num) {
  const div = document.createElement('div');
  div.className = 'round-divider';
  div.textContent = num === 1 ? 'Opening Arguments' : `Round ${num}`;
  document.getElementById('chat-feed').appendChild(div);
}

// ── Message Card ──
function createMessageCard(ai, content) {
  const cfg = AI_CONFIG[ai];
  const card = document.createElement('div');
  card.className = `message message-${ai}`;
  card.innerHTML = `
    <div class="message-header">
      <div class="ai-avatar" style="background:${cfg.color}">${cfg.short}</div>
      <span class="ai-name" style="color:${cfg.color}">${cfg.name}</span>
    </div>
    <div class="message-body">${escapeHtml(content)}</div>
  `;
  return card;
}

async function appendMessage(ai, content) {
  const card = createMessageCard(ai, content);
  const feed = document.getElementById('chat-feed');
  feed.appendChild(card);
  feed.scrollTop = feed.scrollHeight;

  // Trigger entrance animation on next tick
  await delay(30);
  card.classList.add('visible');
  feed.scrollTop = feed.scrollHeight;
}

function showErrorCard(message) {
  const card = document.createElement('div');
  card.className = 'error-card';
  card.textContent = `⚠️ ${message}`;
  const feed = document.getElementById('chat-feed');
  feed.appendChild(card);
  feed.scrollTop = feed.scrollHeight;
  delay(30).then(() => card.classList.add('visible'));
}

// ── Export to PDF ──
function exportToPdf() {
  const AI_COLORS = { openai: '#10a37f', claude: '#d97706', gemini: '#4285f4' };
  const AI_NAMES  = { openai: 'GPT-4',   claude: 'Claude',  gemini: 'Gemini' };

  // Group conversation into rounds of 3
  const rounds = [];
  for (let i = 0; i < conversation.length; i += 3) {
    rounds.push(conversation.slice(i, i + 3));
  }

  const roundsHtml = rounds
    .map((msgs, idx) => {
      const label = idx === 0 ? 'Opening Arguments' : `Round ${idx + 1}`;
      const msgsHtml = msgs
        .map(({ ai, content }) => `
          <div class="msg">
            <div class="msg-header" style="color:${AI_COLORS[ai]}">${AI_NAMES[ai]}</div>
            <div class="msg-body">${escapeHtml(content)}</div>
          </div>`)
        .join('');
      return `<div class="round-label">${escapeHtml(label)}</div>${msgsHtml}`;
    })
    .join('');

  // Collect any verdicts already shown in the DOM
  const verdictNodes = document.querySelectorAll('#verdict-cards .verdict-card');
  let verdictsHtml = '';
  if (verdictNodes.length > 0) {
    const items = Array.from(verdictNodes).map((card) => {
      const avatarStyle = card.querySelector('.verdict-avatar')?.getAttribute('style') || '';
      const colorMatch = avatarStyle.match(/background:([^;]+)/);
      const color = colorMatch ? colorMatch[1].trim() : '#888';
      const name = card.querySelector('.verdict-avatar')?.textContent.trim() || '';
      const text = card.querySelector('.verdict-text')?.textContent.trim() || '';
      return `<div class="verdict-item">
        <span class="verdict-who" style="color:${color}">${escapeHtml(name)}</span>
        <span class="verdict-verdict">${escapeHtml(text)}</span>
      </div>`;
    });
    verdictsHtml = `
      <div class="section-title">The Judges' Verdicts</div>
      <div class="verdicts">${items.join('')}</div>`;
  }

  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>AI Battle — ${escapeHtml(topic)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 11pt;
      color: #1a1a2e;
      background: #fff;
      padding: 2cm 2.2cm;
      line-height: 1.55;
    }
    .doc-header { margin-bottom: 1.6rem; border-bottom: 2px solid #e0e0e8; padding-bottom: 0.9rem; }
    .doc-title { font-size: 18pt; font-weight: 800; color: #0c0c14; margin-bottom: 0.2rem; }
    .doc-meta { font-size: 9pt; color: #666; }
    .round-label {
      font-size: 8pt; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #999;
      margin: 1.2rem 0 0.5rem;
      display: flex; align-items: center; gap: 0.6rem;
    }
    .round-label::after { content: ''; flex: 1; height: 1px; background: #e8e8ef; }
    .msg { margin-bottom: 0.65rem; padding: 0.55rem 0.8rem; border-radius: 6px; background: #f7f7fb; border-left: 3px solid #ddd; page-break-inside: avoid; }
    .msg-header { font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 0.2rem; }
    .msg-body { font-size: 10.5pt; color: #2a2a3e; }
    .section-title {
      font-size: 8pt; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; color: #999; margin-top: 1.6rem;
      margin-bottom: 0.6rem; border-top: 1px solid #e8e8ef; padding-top: 1rem;
    }
    .verdicts { display: flex; flex-direction: column; gap: 0.5rem; }
    .verdict-item { background: #f7f7fb; border-radius: 6px; padding: 0.5rem 0.8rem; page-break-inside: avoid; }
    .verdict-who { font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; display: block; margin-bottom: 0.15rem; }
    .verdict-verdict { font-size: 10pt; color: #2a2a3e; }
    .doc-footer { margin-top: 2rem; padding-top: 0.6rem; border-top: 1px solid #e0e0e8; font-size: 8pt; color: #aaa; text-align: center; }
    @media print {
      body { padding: 0; }
      .msg, .verdict-item { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-title">AI Battle: ${escapeHtml(topic)}</div>
    <div class="doc-meta">${responseCount} responses &bull; ${roundNumber} rounds &bull; ${date}</div>
  </div>
  ${roundsHtml}
  ${verdictsHtml}
  <div class="doc-footer">Generated by AI Battle &bull; ${date}</div>
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Pop-up blocked — please allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ── Fetch Summary / Verdict ──
async function fetchAndShowSummary() {
  const loading = document.getElementById('verdict-loading');
  const verdictSection = document.getElementById('end-verdict');
  const cardsEl = document.getElementById('verdict-cards');

  loading.classList.remove('hidden');

  let data;
  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, conversation }),
    });
    data = await res.json();
  } catch {
    loading.classList.add('hidden');
    return;
  }

  loading.classList.add('hidden');

  if (!data.summaries) return;

  cardsEl.innerHTML = '';
  for (const { ai, content, scores } of data.summaries) {
    const cfg = AI_CONFIG[ai];
    const card = document.createElement('div');
    card.className = 'verdict-card';

    let scoreBarsHtml = '';
    if (scores) {
      const rows = [
        { key: 'openai', ...AI_CONFIG.openai },
        { key: 'claude', ...AI_CONFIG.claude },
        { key: 'gemini', ...AI_CONFIG.gemini },
      ].map(({ key, name, color }) => {
        const score = scores[key] ?? 0;
        return `<div class="score-row">
          <span class="score-label">${escapeHtml(name)}</span>
          <div class="score-track"><div class="score-fill" style="width:${score * 10}%;background:${color}"></div></div>
          <span class="score-num">${score}/10</span>
        </div>`;
      }).join('');
      scoreBarsHtml = `<div class="score-bars">${rows}</div>`;
    }

    card.innerHTML = `
      <div class="verdict-avatar" style="background:${cfg.color}">${cfg.short}</div>
      <div class="verdict-body">${scoreBarsHtml}<div class="verdict-text">${escapeHtml(content)}</div></div>
    `;
    cardsEl.appendChild(card);
    // stagger entrance
    await delay(120);
    card.classList.add('visible');
  }

  verdictSection.classList.remove('hidden');
}

// ── Session End ──
function endSession(reason) {
  if (sessionEnded) return;
  sessionEnded = true;

  const feed = document.getElementById('chat-feed');
  const divider = document.createElement('div');
  divider.className = 'session-end-divider';
  divider.textContent =
    reason === 'auto'
      ? '🏁 Maximum responses reached — debate concluded!'
      : '🛑 Session ended by user';
  feed.appendChild(divider);
  feed.scrollTop = feed.scrollHeight;

  setStatus('');

  // Populate end screen
  const endMsg = document.getElementById('end-message');
  if (reason === 'auto') {
    endMsg.textContent = `After ${MAX_RESPONSES} responses, the debate on "${topic}" finally ran its course. The judges are still deliberating.`;
  } else {
    endMsg.textContent = `The battle over "${topic}" was stopped after ${responseCount} response${responseCount !== 1 ? 's' : ''}. Coward or peacemaker? You decide.`;
  }

  document.getElementById('stat-total').textContent = responseCount;
  document.getElementById('stat-rounds').textContent = roundNumber;

  // Start fetching summaries immediately (runs in parallel with the delay)
  fetchAndShowSummary();

  setTimeout(() => {
    showScreen('screen-end');
    // Repurpose the End Session button as a back-to-summary link
    const endBtn = document.getElementById('end-btn');
    endBtn.textContent = '← Summary';
    endBtn.onclick = () => showScreen('screen-end');
  }, 1600);
}

// ── Fetch One Round ──
async function fetchRound() {
  const res = await fetch('/api/round', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, conversation }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown server error' }));
    throw new Error(err.error || 'Server error');
  }

  return res.json(); // { responses: [{ai, content}] }
}

// ── Main Round Loop ──
async function runNextRound() {
  if (sessionEnded || responseCount >= MAX_RESPONSES) {
    endSession('auto');
    return;
  }

  roundNumber++;
  addRoundDivider(roundNumber);

  setStatus(
    roundNumber === 1
      ? 'AIs are formulating their opening arguments…'
      : 'AIs are reading the debate and crafting their retorts…',
    true
  );

  let data;
  try {
    data = await fetchRound();
  } catch (err) {
    setStatus('');
    showErrorCard(err.message);
    return; // Stop the loop on error
  }

  setStatus('');

  // Display each response with a stagger
  for (let i = 0; i < data.responses.length; i++) {
    if (sessionEnded) return;

    const { ai, content } = data.responses[i];
    conversation.push({ ai, content });
    responseCount++;
    updateProgress();

    await appendMessage(ai, content);

    // Check limit mid-round
    if (responseCount >= MAX_RESPONSES) {
      endSession('auto');
      return;
    }

    if (i < data.responses.length - 1) {
      await delay(MESSAGE_DELAY);
    }
  }

  // Schedule the next round automatically
  if (!sessionEnded && responseCount < MAX_RESPONSES) {
    setStatus('Next round starting…');
    await delay(BETWEEN_ROUND_DELAY);
    if (!sessionEnded) {
      setStatus('');
      await runNextRound();
    }
  } else {
    endSession('auto');
  }
}

// ── Check API Status ──
async function checkApiStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const status = await res.json();

    const missing = [];
    if (!status.openai) missing.push('OpenAI');
    if (!status.claude) missing.push('Anthropic/Claude');
    if (!status.gemini) missing.push('Gemini');

    if (missing.length > 0) {
      const warning = document.getElementById('api-warning');
      const warningText = document.getElementById('api-warning-text');
      warningText.textContent = `Missing API keys: ${missing.join(', ')}. Add them as secrets in your Cloudflare Pages project settings.`;
      warning.classList.remove('hidden');
    }
  } catch {
    // Server might not be ready, ignore
  }
}

// ── Event Listeners ──
document.addEventListener('DOMContentLoaded', () => {
  checkApiStatus();
});

document.getElementById('start-btn').addEventListener('click', async () => {
  const input = document.getElementById('topic-input');
  const value = input.value.trim();

  if (!value) {
    input.classList.add('shake');
    input.focus();
    input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
    return;
  }

  // Reset state
  topic = value;
  conversation = [];
  responseCount = 0;
  roundNumber = 0;
  sessionEnded = false;

  // Reset UI
  document.getElementById('chat-feed').innerHTML = '';
  document.getElementById('battle-topic-text').textContent = topic;
  updateProgress();

  showScreen('screen-battle');
  await runNextRound();
});

document.getElementById('topic-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('start-btn').click();
});

document.getElementById('end-btn').addEventListener('click', () => {
  endSession('manual');
});

document.getElementById('export-btn').addEventListener('click', exportToPdf);

document.getElementById('review-btn').addEventListener('click', () => {
  showScreen('screen-battle');
  // Scroll chat to bottom so the end divider is visible
  const feed = document.getElementById('chat-feed');
  feed.scrollTop = feed.scrollHeight;
});

document.getElementById('restart-btn').addEventListener('click', () => {
  // Reset the End Session button back to its original state
  const endBtn = document.getElementById('end-btn');
  endBtn.textContent = 'End Session';
  endBtn.onclick = null;

  // Clear verdict section for next battle
  document.getElementById('end-verdict').classList.add('hidden');
  document.getElementById('verdict-loading').classList.add('hidden');
  document.getElementById('verdict-cards').innerHTML = '';

  document.getElementById('topic-input').value = '';
  showScreen('screen-landing');
  checkApiStatus();
});
