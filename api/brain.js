// CORBEX AI BRAIN — Vercel Serverless Function
// Runs on demand or via cron, reads Supabase, makes decisions via Claude API

const SUPABASE_URL = 'https://ylrlyvwulspiqokdonpi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlscmx5dnd1bHNwaXFva2RvbnBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MjI1NzEsImV4cCI6MjA5NjI5ODU3MX0.trpVUX66rqBADs8iXj5G6nlTjSQBbIUriLtlCEFqkg4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ─── SUPABASE HELPERS ────────────────────────────────────────────────────────
async function sbGet(table, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  return r.json();
}

async function sbInsert(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  return r.ok;
}

async function sbUpdate(table, id, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  return r.ok;
}

// ─── CLAUDE API ──────────────────────────────────────────────────────────────
async function askClaude(systemPrompt, userPrompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

// ─── DECISION LOGGER ─────────────────────────────────────────────────────────
async function logDecision(type, decision, reasoning, context = {}) {
  await sbInsert('ai_decisions', {
    decision_type: type,
    decision,
    reasoning,
    input_context: JSON.stringify(context),
    lead_id: context.lead_id || null,
    client_id: context.client_id || null,
    campaign_id: context.campaign_id || null
  });
}

// ─── TASK 1: SCORE LEADS ─────────────────────────────────────────────────────
async function scoreLeads() {
  const leads = await sbGet('leads', 'ai_score=eq.0&status=neq.unsubscribed&limit=20');
  if (!leads?.length) return { scored: 0 };

  const results = [];
  for (const lead of leads) {
    const prompt = `Score this lead 0-100 for a web design agency targeting US businesses.
Lead data:
- Name: ${lead.first_name} ${lead.last_name}
- Company: ${lead.company_name}
- Niche: ${lead.niche}
- Status: ${lead.status}
- City: ${lead.city}, ${lead.state}
- Has website: ${lead.website ? 'Yes - ' + lead.website : 'No'}

Scoring criteria:
- High income niches (med_spa, law_firm) = higher score
- No website or bad website = higher score
- Replied or opened email = higher score
- US location = required (must be 50+)
- Owner/decision maker title = higher score

Respond with ONLY a JSON object: {"score": 85, "reason": "Med spa in Miami, no website found, high budget niche"}`;

    try {
      const resp = await askClaude(
        'You are a lead scoring AI for a web design agency. Score leads based on their likelihood to convert. Always respond with valid JSON only.',
        prompt
      );
      const clean = resp.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      await sbUpdate('leads', lead.id, { ai_score: parsed.score, ai_notes: parsed.reason });
      await logDecision('lead_score', `Scored ${lead.first_name} ${lead.last_name}: ${parsed.score}/100`, parsed.reason, { lead_id: lead.id });
      results.push({ id: lead.id, score: parsed.score });
    } catch (e) {
      console.error('Score error:', e.message);
    }
  }
  return { scored: results.length, results };
}

// ─── TASK 2: ANALYZE CAMPAIGNS ───────────────────────────────────────────────
async function analyzeCampaigns() {
  const campaigns = await sbGet('campaigns', 'status=eq.active');
  if (!campaigns?.length) return { analyzed: 0 };

  const decisions = [];
  for (const camp of campaigns) {
    const prompt = `Analyze this email campaign for a US web design agency and decide what action to take.

Campaign: ${camp.name}
Niche: ${camp.niche}
Status: ${camp.status}
Emails sent: ${camp.emails_sent}
Open rate: ${camp.open_rate}%
Reply rate: ${camp.reply_rate}%
Booked calls: ${camp.booked_calls}
Closed deals: ${camp.closed_deals}
Revenue generated: $${camp.revenue_generated}

Industry benchmarks: Open rate avg 21%, Reply rate avg 3%, Good open rate 30%+

Decide ONE action:
1. "continue" - performing well, keep running
2. "pause" - poor performance, needs rework
3. "scale" - great performance, increase volume
4. "optimize" - decent but needs subject line or copy tweaks

Respond with ONLY JSON: {"action": "continue", "reason": "38% open rate above benchmark, 3 calls booked this week", "new_status": "active"}`;

    try {
      const resp = await askClaude(
        'You are a campaign optimization AI for a web design agency. Analyze campaign metrics and make data-driven decisions. Always respond with valid JSON only.',
        prompt
      );
      const clean = resp.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      if (parsed.new_status && parsed.new_status !== camp.status) {
        await sbUpdate('campaigns', camp.id, { status: parsed.new_status });
      }
      await logDecision('campaign', `${parsed.action.toUpperCase()} campaign "${camp.name}"`, parsed.reason, { campaign_id: camp.id });
      decisions.push({ campaign: camp.name, action: parsed.action, reason: parsed.reason });
    } catch (e) {
      console.error('Campaign error:', e.message);
    }
  }
  return { analyzed: decisions.length, decisions };
}

// ─── TASK 3: WRITE EMAIL SEQUENCES ───────────────────────────────────────────
async function writeEmails() {
  // Find leads that need follow-up emails
  const leads = await sbGet('leads', 'status=eq.new&ai_score=gte.60&limit=5');
  if (!leads?.length) return { written: 0 };

  const written = [];
  for (const lead of leads) {
    const prompt = `Write a cold email for this US business lead for our web design agency "Corbex".

Lead:
- Name: ${lead.first_name} ${lead.last_name}
- Company: ${lead.company_name}
- Niche: ${lead.niche}
- City: ${lead.city}, ${lead.state}

Rules:
- Sound like a real American person, not a robot
- 3-4 sentences max
- Focus on their specific pain (no website = missing customers)
- End with ONE soft call to action (15-min call)
- Never mention "AI" or "agency" directly
- Subject line must be curious/specific, not salesy

Respond with ONLY JSON: {"subject": "Quick question about Carter HVAC", "body": "Hey James,\n\nI was searching for HVAC companies in Houston and noticed Carter HVAC doesn't have a website yet...\n\nWould a quick 15-min call make sense?\n\n— Alex, Corbex"}`;

    try {
      const resp = await askClaude(
        'You are an expert cold email copywriter. Write personalized, human-sounding cold emails that get replies. Always respond with valid JSON only.',
        prompt
      );
      const clean = resp.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      await sbInsert('emails', {
        lead_id: lead.id,
        subject: parsed.subject,
        body: parsed.body,
        sequence_step: 1,
        status: 'queued',
        ai_generated: true
      });
      await logDecision('email', `Wrote email for ${lead.first_name} ${lead.last_name}`, `Subject: ${parsed.subject}`, { lead_id: lead.id });
      written.push({ lead: lead.first_name + ' ' + lead.last_name, subject: parsed.subject });
    } catch (e) {
      console.error('Email write error:', e.message);
    }
  }
  return { written: written.length, emails: written };
}

// ─── TASK 4: WRITE SOCIAL POSTS ──────────────────────────────────────────────
async function writeSocialPosts() {
  // Check if we have fewer than 5 scheduled posts
  const existing = await sbGet('social_posts', 'status=eq.scheduled&select=id');
  if (existing?.length >= 5) return { created: 0, reason: 'Enough posts scheduled' };

  const topics = [
    'Before/after website transformation for an HVAC company',
    '3 reasons your local business needs a website in 2025',
    'How a dentist in Texas got 40% more calls after redesigning their site',
    'What makes a $10,000 website worth it for local businesses',
    'The #1 mistake small businesses make with their online presence'
  ];

  const topic = topics[Math.floor(Math.random() * topics.length)];
  const platform = Math.random() > 0.5 ? 'linkedin' : 'instagram';

  const prompt = `Write a ${platform} post for Corbex, a web design agency targeting US local businesses.

Topic: ${topic}
Platform: ${platform}
Tone: Professional but conversational, like a knowledgeable founder sharing insights
Length: ${platform === 'linkedin' ? '150-200 words with line breaks' : '80-120 words'}

Do NOT use: 
- Cringe hooks like "I just realized..."  
- Excessive emojis
- Generic AI-sounding phrases

DO use:
- Specific numbers and examples
- A clear insight or takeaway
- One relevant hashtag at the end

Respond with ONLY JSON: {"content": "post text here", "platform": "linkedin"}`;

  try {
    const resp = await askClaude(
      'You are a social media copywriter for a web design agency. Write authentic, non-cringe posts that establish authority and attract US business clients.',
      prompt
    );
    const clean = resp.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    const scheduleDate = new Date();
    scheduleDate.setDate(scheduleDate.getDate() + Math.floor(Math.random() * 7) + 1);

    await sbInsert('social_posts', {
      platform: parsed.platform || platform,
      content: parsed.content,
      status: 'scheduled',
      scheduled_for: scheduleDate.toISOString(),
      ai_generated: true
    });
    await logDecision('social_post', `Wrote ${platform} post: "${topic.substring(0, 40)}..."`, 'Auto-generated to maintain posting schedule', {});
    return { created: 1, platform, topic };
  } catch (e) {
    console.error('Social post error:', e.message);
    return { created: 0, error: e.message };
  }
}

// ─── TASK 5: CLIENT HEALTH CHECK ─────────────────────────────────────────────
async function checkClientHealth() {
  const clients = await sbGet('clients', 'status=eq.active&retainer_active=eq.true');
  if (!clients?.length) return { checked: 0 };

  const tasks_to_create = [];
  for (const client of clients) {
    // Check if retainer payment is due
    if (client.next_billing_date) {
      const daysUntilBilling = Math.ceil((new Date(client.next_billing_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilBilling <= 3 && daysUntilBilling >= 0) {
        tasks_to_create.push({
          title: `Send invoice to ${client.business_name} — $${client.monthly_retainer} retainer due`,
          type: 'invoice',
          requires_human: true,
          client_id: client.id,
          due_at: client.next_billing_date
        });
      }
    }
  }

  for (const task of tasks_to_create) {
    await sbInsert('tasks', task);
    await logDecision('campaign', `Created task: ${task.title}`, 'Retainer billing reminder auto-generated', { client_id: task.client_id });
  }

  return { checked: clients.length, tasks_created: tasks_to_create.length };
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Allow GET for manual trigger, POST for cron
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional: protect with a secret key
  const secret = req.headers['x-brain-secret'] || req.query.secret;
  if (process.env.BRAIN_SECRET && secret !== process.env.BRAIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment variables' });
  }

  console.log('🧠 Corbex AI Brain starting...');
  const startTime = Date.now();

  try {
    const [leads, campaigns, emails, social, health] = await Promise.all([
      scoreLeads(),
      analyzeCampaigns(),
      writeEmails(),
      writeSocialPosts(),
      checkClientHealth()
    ]);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = {
      status: 'success',
      duration_seconds: duration,
      timestamp: new Date().toISOString(),
      results: { leads, campaigns, emails, social, health }
    };

    console.log('✅ Brain run complete:', JSON.stringify(summary, null, 2));
    return res.status(200).json(summary);

  } catch (err) {
    console.error('Brain error:', err);
    return res.status(500).json({ status: 'error', error: err.message });
  }
}
