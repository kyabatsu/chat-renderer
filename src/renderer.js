/**
 * Renderer
 * Puppeteer-based HTML screenshot capture
 */

const puppeteer = require('puppeteer');
const path = require('path');
const config = require('../config');

class Renderer {
  constructor(broadcasterId = null) {
    this.browser = null;
    this.page = null;
    this.templatePath = path.resolve(__dirname, '../template/chat.html');
    this.broadcasterId = broadcasterId;
    
    // Resolve assets path to absolute file:// URL
    if (broadcasterId) {
      this.assetsPath = 'file://' + path.resolve(__dirname, '../assets', broadcasterId);
    } else {
      this.assetsPath = 'file://' + path.resolve(__dirname, '..', config.ASSETS_DIR);
    }
  }

  /**
   * Initialize Puppeteer browser and page
   */
  async initialize() {
    this.browser = await puppeteer.launch({
      headless: config.PUPPETEER_HEADLESS,
      args: config.PUPPETEER_ARGS,
    });

    this.page = await this.browser.newPage();

    // Set viewport to output dimensions
    await this.page.setViewport({
      width: config.OUTPUT_WIDTH,
      height: config.OUTPUT_HEIGHT,
      deviceScaleFactor: 1,
    });

    // Load the chat template
    await this.page.goto(`file://${this.templatePath}`, {
      waitUntil: 'domcontentloaded',
    });

    // Inject config AND apply styles (must do both since page script already ran with defaults)
    await this.page.evaluate((cfg) => {
      window.CHAT_CONFIG = cfg;
      
      // Re-apply CSS variables now that we have real config
      document.documentElement.style.setProperty('--font-size', cfg.fontSize + 'px');
      document.documentElement.style.setProperty('--line-height', cfg.lineHeight);
      document.documentElement.style.setProperty('--text-color', cfg.textColor);
      document.documentElement.style.setProperty('--username-color', cfg.usernameColor);
      document.documentElement.style.setProperty('--chroma-color', cfg.chromaColor);
    }, {
      fontSize: config.FONT_SIZE_PX,
      lineHeight: config.LINE_HEIGHT_MULTIPLIER,
      textColor: config.TEXT_COLOR,
      usernameColor: config.USERNAME_COLOR,
      chromaColor: config.CHROMA_KEY_COLOR,
      assetsDir: this.assetsPath,
      badgesSubdir: config.BADGES_SUBDIR,
      emojisSubdir: config.EMOJIS_SUBDIR,
      superchatTiers: config.SUPERCHAT_TIERS,
      bitsTiers: config.BITS_TIERS,
    });

    console.log(`[Renderer] Initialized at ${config.OUTPUT_WIDTH}x${config.OUTPUT_HEIGHT}`);
    console.log(`[Renderer] Assets path: ${this.assetsPath}`);
  }

  /**
   * Update the chat display with new state
   * @param chatState - State object from ChatState.getState()
   */
  async updateChat(chatState) {
    await this.page.evaluate((state) => {
      if (typeof window.updateChat === 'function') {
        window.updateChat(state);
      } else {
        console.error('updateChat function not found in template');
      }
    }, chatState);
  }

  /**
   * Capture current state as PNG buffer
   * @returns PNG Buffer
   */
  async capturePngFrame() {
    return await this.page.screenshot({
      type: 'png',
      omitBackground: false,
      encoding: 'binary',
    });
  }

  /**
   * Cleanup
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      console.log('[Renderer] Closed');
    }
  }
}

module.exports = Renderer;