/**
 * Twitch Asset Fetcher
 * Scans TwitchDownloader JSON and fetches all badges + emotes
 * 
 * Usage:
 *   node scripts/fetch-assets.js <chat.json> --client-id=XXX --token=YYY
 * 
 * Or set environment variables:
 *   TWITCH_CLIENT_ID=XXX TWITCH_TOKEN=YYY node scripts/fetch-assets.js <chat.json>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// === Configuration ===
const ASSETS_DIR = path.resolve(__dirname, '../assets');
const BADGES_DIR = path.join(ASSETS_DIR, 'badges');
const EMOJIS_DIR = path.join(ASSETS_DIR, 'emojis');

// Parse CLI args
const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--'));
const clientId = args.find(a => a.startsWith('--client-id='))?.split('=')[1] || process.env.TWITCH_CLIENT_ID;
const accessToken = args.find(a => a.startsWith('--token='))?.split('=')[1] || process.env.TWITCH_TOKEN;

if (!jsonPath) {
  console.log('Usage: node fetch-assets.js <chat.json> --client-id=XXX --token=YYY');
  process.exit(1);
}

if (!clientId || !accessToken) {
  console.error('Error: Missing Twitch credentials. Provide --client-id and --token, or set TWITCH_CLIENT_ID and TWITCH_TOKEN env vars.');
  process.exit(1);
}

// === Helpers ===

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location, headers).then(resolve).catch(reject);
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${buffer.toString()}`));
        } else {
          resolve({ buffer, contentType: res.headers['content-type'] });
        }
      });
    });
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  const { buffer } = await fetch(url, {
    'Client-ID': clientId,
    'Authorization': `Bearer ${accessToken}`,
  });
  return JSON.parse(buffer.toString());
}

async function downloadFile(url, destPath) {
  try {
    const { buffer } = await fetch(url);
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`  Failed to download ${url}: ${err.message}`);
    return false;
  }
}

function getExtension(url, contentType) {
  // Try to get from URL first
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  if (urlExt && ['.png', '.gif', '.jpg', '.jpeg', '.webp'].includes(urlExt)) {
    return urlExt;
  }
  // Fall back to content type
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  return '.png'; // default
}

// === Main Logic ===

async function main() {
  console.log(`[Fetcher] Loading ${jsonPath}...`);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  
  const broadcasterId = data.streamer?.id?.toString();
  console.log(`[Fetcher] Broadcaster: ${data.streamer?.name} (${broadcasterId})`);
  
  // Ensure directories exist
  fs.mkdirSync(BADGES_DIR, { recursive: true });
  fs.mkdirSync(EMOJIS_DIR, { recursive: true });

  // === Scan for unique badges and emotes ===
  const badgeSet = new Map(); // key: "id/version", value: { id, version }
  const emoteSet = new Set(); // emote IDs

  for (const comment of data.comments || []) {
    // Collect badges
    for (const badge of comment.message?.user_badges || []) {
      const key = `${badge._id}/${badge.version}`;
      if (!badgeSet.has(key)) {
        badgeSet.set(key, { id: badge._id, version: badge.version });
      }
    }

    // Collect emotes from fragments
    for (const frag of comment.message?.fragments || []) {
      if (frag.emoticon?.emoticon_id) {
        emoteSet.add(frag.emoticon.emoticon_id);
      }
    }
  }

  console.log(`[Fetcher] Found ${badgeSet.size} unique badges, ${emoteSet.size} unique emotes`);

  // === Fetch badge definitions from Twitch API ===
  console.log('\n[Fetcher] Fetching badge definitions...');
  
  const badgeUrls = new Map(); // "id/version" -> url

  // Global badges
  try {
    const globalBadges = await fetchJson('https://api.twitch.tv/helix/chat/badges/global');
    for (const badge of globalBadges.data || []) {
      for (const version of badge.versions || []) {
        const key = `${badge.set_id}/${version.id}`;
        badgeUrls.set(key, version.image_url_2x || version.image_url_1x);
      }
    }
    console.log(`  Global badges: ${globalBadges.data?.length || 0} sets`);
  } catch (err) {
    console.error(`  Failed to fetch global badges: ${err.message}`);
  }

  // Channel badges
  if (broadcasterId) {
    try {
      const channelBadges = await fetchJson(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${broadcasterId}`);
      for (const badge of channelBadges.data || []) {
        for (const version of badge.versions || []) {
          const key = `${badge.set_id}/${version.id}`;
          badgeUrls.set(key, version.image_url_2x || version.image_url_1x);
        }
      }
      console.log(`  Channel badges: ${channelBadges.data?.length || 0} sets`);
    } catch (err) {
      console.error(`  Failed to fetch channel badges: ${err.message}`);
    }
  }

  // === Download badges ===
  console.log('\n[Fetcher] Downloading badges...');
  let badgeSuccess = 0, badgeFail = 0;

  for (const [key, { id, version }] of badgeSet) {
    const url = badgeUrls.get(key);
    const filename = `${id}_${version}.png`;
    const destPath = path.join(BADGES_DIR, filename);

    if (fs.existsSync(destPath)) {
      console.log(`  Skip (exists): ${filename}`);
      badgeSuccess++;
      continue;
    }

    if (!url) {
      console.log(`  Skip (no URL): ${key}`);
      badgeFail++;
      continue;
    }

    process.stdout.write(`  Downloading: ${filename}...`);
    if (await downloadFile(url, destPath)) {
      console.log(' OK');
      badgeSuccess++;
    } else {
      badgeFail++;
    }

    // Rate limit courtesy
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`[Fetcher] Badges: ${badgeSuccess} downloaded, ${badgeFail} failed`);

  // === Download emotes ===
  console.log('\n[Fetcher] Downloading emotes...');
  let emoteSuccess = 0, emoteFail = 0;

  for (const emoteId of emoteSet) {
    // Try animated first (gif), fall back to static (png)
    const urls = [
      `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/animated/dark/3.0`,
      `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/3.0`,
    ];

    // Check if we already have it (either extension)
    const existingPng = path.join(EMOJIS_DIR, `${emoteId}.png`);
    const existingGif = path.join(EMOJIS_DIR, `${emoteId}.gif`);
    if (fs.existsSync(existingPng) || fs.existsSync(existingGif)) {
      console.log(`  Skip (exists): ${emoteId}`);
      emoteSuccess++;
      continue;
    }

    let downloaded = false;
    for (const url of urls) {
      try {
        const { buffer, contentType } = await fetch(url);
        const ext = contentType?.includes('gif') ? '.gif' : '.png';
        const destPath = path.join(EMOJIS_DIR, `${emoteId}${ext}`);
        fs.writeFileSync(destPath, buffer);
        console.log(`  Downloaded: ${emoteId}${ext}`);
        downloaded = true;
        break;
      } catch {
        // Try next URL
      }
    }

    if (downloaded) {
      emoteSuccess++;
    } else {
      console.log(`  Failed: ${emoteId}`);
      emoteFail++;
    }

    // Rate limit courtesy
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`[Fetcher] Emotes: ${emoteSuccess} downloaded, ${emoteFail} failed`);

  // === Summary ===
  console.log('\n=== Summary ===');
  console.log(`Badges: ${badgeSuccess}/${badgeSet.size} in ${BADGES_DIR}`);
  console.log(`Emotes: ${emoteSuccess}/${emoteSet.size} in ${EMOJIS_DIR}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});