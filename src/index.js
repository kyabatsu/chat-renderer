/**
 * Chat Renderer - Main Entry Point
 * Orchestrates the full rendering pipeline
 */

const fs = require('fs').promises;
const path = require('path');

const config = require('../config');
const MessageBatcher = require('./batcher');
const ChatState = require('./chat-state');
const FrameScheduler = require('./frame-scheduler');
const Renderer = require('./renderer');
const Encoder = require('./encoder');

class ChatRenderer {
  constructor(inputJsonPath, outputVideoPath) {
    this.inputJsonPath = inputJsonPath;
    this.outputVideoPath = outputVideoPath;

    this.messages = [];
    this.batcher = null;
    this.chatState = null;
    this.scheduler = null;
    this.renderer = null;
    this.encoder = null;
  }

  /**
   * Load and parse the unified chat JSON
   */
  async loadMessages() {
    console.log(`[Main] Loading messages from ${this.inputJsonPath}`);
    
    const raw = await fs.readFile(this.inputJsonPath, 'utf-8');
    const data = JSON.parse(raw);

    // TODO: Adjust based on your unified schema structure
    // Expecting either an array directly or { messages: [...] }
    this.messages = Array.isArray(data) ? data : data.messages;

    // Ensure sorted by timestamp
    this.messages.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

    console.log(`[Main] Loaded ${this.messages.length} messages`);
    
    // Log first and last message times for sanity check
    if (this.messages.length > 0) {
      const first = this.messages[0].timestamp_ms;
      const last = this.messages[this.messages.length - 1].timestamp_ms;
      console.log(`[Main] Time range: ${this._formatTime(first)} - ${this._formatTime(last)}`);
    }
  }

  /**
   * Initialize all components
   */
  async initialize() {
    console.log('[Main] Initializing components...');

    this.batcher = new MessageBatcher(this.messages);
    this.chatState = new ChatState();
    this.scheduler = new FrameScheduler(this.batcher.streamDurationMs);
    this.renderer = new Renderer();
    this.encoder = new Encoder(this.outputVideoPath);

    await this.renderer.initialize();
    this.encoder.start();

    console.log(`[Main] Stream duration: ${this._formatTime(this.batcher.streamDurationMs)}`);
    console.log(`[Main] Total frames to generate: ${this.scheduler.totalFrames}`);
  }

  /**
   * Main render loop
   */
  async render() {
    console.log('[Main] Starting render...');
    const startTime = Date.now();
    let lastProgressLog = 0;

    // Render initial empty state
    let currentFrame = await this._captureAndWrite();

    while (!this.scheduler.isDone()) {
      const currentTimeMs = this.scheduler.getCurrentTimeMs();

      // Get next batch of messages
      const { messages: batch, nextBatchTimeMs } = this.batcher.getNextBatch(currentTimeMs);

      // If we got messages, update state and capture new frame
      if (batch.length > 0) {
        this.chatState.addMessages(batch);
        await this.renderer.updateChat(this.chatState.getState());
        currentFrame = await this.renderer.capturePngFrame();
      }

      // Calculate how many frames to hold this state
      const frameCount = this.scheduler.getFrameCountUntil(nextBatchTimeMs);

      // Write frame(s) to encoder
      await this.encoder.writeFrameRepeat(currentFrame, frameCount);
      this.scheduler.skipFrames(frameCount);

      // Progress logging (every 5%)
      const progress = this.scheduler.getProgress();
      if (progress - lastProgressLog >= 5) {
        const elapsed = (Date.now() - startTime) / 1000;
        const eta = (elapsed / progress) * (100 - progress);
        console.log(
          `[Main] Progress: ${progress.toFixed(1)}% | ` +
          `Time: ${this.scheduler.getTimeString()} | ` +
          `Frames: ${this.encoder.frameCount} | ` +
          `ETA: ${this._formatSeconds(eta)}`
        );
        lastProgressLog = progress;
      }
    }

    // Finalize
    await this.encoder.finish();
    await this.renderer.close();

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`[Main] Render complete in ${this._formatSeconds(totalTime)}`);
    console.log(`[Main] Output: ${this.outputVideoPath}`);
    console.log(`[Main] Total frames: ${this.encoder.frameCount}`);
  }

  /**
   * Capture and write a single frame
   */
  async _captureAndWrite() {
    const frame = await this.renderer.capturePngFrame();
    await this.encoder.writeFrame(frame);
    this.scheduler.advance();
    return frame;
  }

  /**
   * Format milliseconds as HH:MM:SS
   */
  _formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }

  /**
   * Format seconds as human readable
   */
  _formatSeconds(sec) {
    if (sec < 60) return `${sec.toFixed(0)}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  }

  /**
   * Full pipeline execution
   */
  async run() {
    try {
      await this.loadMessages();
      await this.initialize();
      await this.render();
    } catch (err) {
      console.error('[Main] Fatal error:', err);
      
      // Cleanup on error
      if (this.renderer) await this.renderer.close();
      if (this.encoder) await this.encoder.finish();
      
      throw err;
    }
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node src/index.js <input.json> <output.mp4>');
    console.log('');
    console.log('Example:');
    console.log('  node src/index.js ./data/chat.json ./output/chat-overlay.mp4');
    process.exit(1);
  }

  const [inputPath, outputPath] = args;

  const renderer = new ChatRenderer(
    path.resolve(inputPath),
    path.resolve(outputPath)
  );

  await renderer.run();
}

// Export for programmatic use
module.exports = ChatRenderer;

// Run if called directly
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
