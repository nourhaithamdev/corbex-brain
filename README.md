# Corbex AI Brain

The autonomous AI manager for Corbex Agency. Powered by Claude API.

## What it does every hour:
1. **Scores leads** — grades every new lead 0-100 based on niche, location, website status
2. **Analyzes campaigns** — decides to continue, pause, scale, or optimize each campaign
3. **Writes emails** — generates personalized cold emails for high-scoring leads
4. **Creates social posts** — writes LinkedIn/Instagram content and schedules it
5. **Checks client health** — creates billing tasks, flags at-risk clients

## Setup (5 minutes):

### Step 1: Get your Anthropic API key
1. Go to console.anthropic.com
2. Click API Keys → Create Key
3. Copy the key (starts with sk-ant-)

### Step 2: Deploy to Vercel
1. Go to github.com/nourhaithamdev → create new repo called "corbex-brain"
2. Upload all files from this folder
3. Go to Vercel → Add New Project → select corbex-brain
4. Before deploying, add Environment Variable:
   - Name: ANTHROPIC_API_KEY
   - Value: sk-ant-... (your key)
5. Deploy

### Step 3: Test it
Visit: https://corbex-brain.vercel.app/api/brain
You should see a JSON response with all the AI decisions made.

### Step 4: Watch the dashboard
Go to corbex-dashboard.vercel.app — you'll see:
- Leads getting scored automatically
- AI decisions appearing in the feed
- Emails being queued
- Social posts being scheduled

## The brain runs automatically every hour via Vercel Cron.
## You can also trigger it manually by visiting the URL above.
