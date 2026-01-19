/**
 * Chat Renderer Configuration
 * All tuneable parameters in one place
 */

module.exports = {
  // === Output Dimensions ===
  OUTPUT_WIDTH: 400,
  OUTPUT_HEIGHT: 1080,

  // === Timing ===
  FRAMERATE: 30,
  BATCH_WINDOW_MS: 500,
  BATCH_MAX_MESSAGES: 12,

  // === Chat Display ===
  FONT_SIZE_PX: 16,
  LINE_HEIGHT_MULTIPLIER: 1.4,
  MAX_VISIBLE_LINES: 27,
  MESSAGE_PADDING_PX: 4,
  HORIZONTAL_PADDING_PX: 12,

  // === Colors ===
  CHROMA_KEY_COLOR: '#000000',
  TEXT_COLOR: '#FFFFFF',
  USERNAME_COLOR: '#AAAAAA',        // Default, overridden by user color if available
  TIMESTAMP_COLOR: '#666666',

  // === Superchat / Bits / Membership Tiers ===
  // Placeholder - adjust based on your unified schema
  SUPERCHAT_TIERS: {
    TIER_1: { bg: '#1565C0', minAmount: 0 },
    TIER_2: { bg: '#00897B', minAmount: 5 },
    TIER_3: { bg: '#FFB300', minAmount: 10 },
    TIER_4: { bg: '#E65100', minAmount: 50 },
    TIER_5: { bg: '#D50000', minAmount: 100 },
  },

  BITS_TIERS: {
    TIER_1: { color: '#979797', minBits: 1 },
    TIER_2: { color: '#9C3EE8', minBits: 100 },
    TIER_3: { color: '#1DB2A5', minBits: 1000 },
    TIER_4: { color: '#0099FE', minBits: 5000 },
    TIER_5: { color: '#FF0000', minBits: 10000 },
  },

  // === Asset Paths ===
  ASSETS_DIR: './assets',
  BADGES_SUBDIR: 'badges',
  EMOJIS_SUBDIR: 'emojis',

  // === FFmpeg ===
  FFMPEG_PATH: 'ffmpeg',            // Or full path if not in PATH
  OUTPUT_CODEC: 'libx264',          // H.264
  OUTPUT_PRESET: 'medium',          // Encoding speed/quality tradeoff
  OUTPUT_CRF: 18,                   // Quality (lower = better, 18-23 typical)

  // === Puppeteer ===
  PUPPETEER_HEADLESS: true,
  PUPPETEER_ARGS: ['--no-sandbox', '--disable-setuid-sandbox'],
};
