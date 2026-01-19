/**
 * Fetch all badges (global + channel) and channel-specific emotes only
 * 
 * Usage:
 *   node fetch-channel-assets.js <broadcaster_id> --client-id=XXX --token=YYY
 * 
 * Example:
 *   node fetch-channel-assets.js 664177022 --client-id=abc --token=xyz
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
const broadcasterId = args.find(a => !a.startsWith('--'));
const clientId = args.find(a => a.startsWith('--client-id='))?.split('=')[1] || process.env.TWITCH_CLIENT_ID;
const token = args.find(a => a.startsWith('--token='))?.split('=')[1] || process.env.TWITCH_TOKEN;

if (!broadcasterId || !clientId || !token) {
  console.log('Usage: node fetch-channel-assets.js <broadcaster_id> --client-id=XXX --token=YYY');
  console.log('Example: node fetch-channel-assets.js 664177022 --client-id=abc --token=xyz');
  process.exit(1);
}

const BADGES_DIR = path.resolve(__dirname, '../assets/',broadcasterId,'/badges');
const EMOJIS_DIR = path.resolve(__dirname, '../assets/',broadcasterId,'/emojis');
const CHANNEL_EMOTES_LIST = path.resolve(__dirname, '../assets/',broadcasterId,'/channel_emotes.json');

fs.mkdirSync(BADGES_DIR, { recursive: true });
fs.mkdirSync(EMOJIS_DIR, { recursive: true });

const fetchJson = (url) => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => res.statusCode < 400 ? resolve(JSON.parse(data)) : reject(new Error(data)));
  }).on('error', reject);
});

const download = (url, dest) => new Promise((resolve) => {
  if (fs.existsSync(dest)) return resolve(true);
  https.get(url, res => {
    if (res.statusCode === 301 || res.statusCode === 302) return download(res.headers.location, dest).then(resolve);
    if (res.statusCode >= 400) return resolve(false);
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(true); });
  }).on('error', () => resolve(false));
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`Fetching assets for broadcaster ${broadcasterId}...\n`);

  // === BADGES ===
  console.log('--- Badges ---');
  const [global, channel] = await Promise.all([
    fetchJson('https://api.twitch.tv/helix/chat/badges/global'),
    fetchJson(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${broadcasterId}`)
  ]);

  const allBadges = [...(global.data || []), ...(channel.data || [])];
  let badgeCount = 0;

  for (const badge of allBadges) {
    for (const v of badge.versions || []) {
      const url = v.image_url_2x || v.image_url_1x;
      const dest = path.join(BADGES_DIR, `${badge.set_id}_${v.id}.png`);
      if (await download(url, dest)) badgeCount++;
      await sleep(30);
    }
  }
  console.log(`Downloaded ${badgeCount} badges\n`);

  // === CHANNEL EMOTES ONLY ===
  console.log('--- Channel Emotes ---');
  const emotes = await fetchJson(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${broadcasterId}`);
  const emoteIds = [];
  let emoteCount = 0;

  for (const e of emotes.data || []) {
    emoteIds.push(e.id);
    const url = e.format.includes('animated')
      ? `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/animated/dark/3.0`
      : `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/static/dark/3.0`;
    const ext = e.format.includes('animated') ? '.gif' : '.png';
    const dest = path.join(EMOJIS_DIR, `${e.id}${ext}`);
    if (await download(url, dest)) emoteCount++;
    await sleep(30);
  }

  // Save list of channel emote IDs for the renderer to check
  fs.writeFileSync(CHANNEL_EMOTES_LIST, JSON.stringify(emoteIds, null, 2));
  console.log(`Downloaded ${emoteCount} channel emotes`);
  console.log(`Saved emote ID list to ${CHANNEL_EMOTES_LIST}\n`);

  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });