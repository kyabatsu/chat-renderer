/**
 * Message Batcher
 * Groups incoming messages by time window or count threshold
 */

const config = require('../config');

class MessageBatcher {
  constructor(messages) {
    /**
     * @param messages - Array of unified chat messages, sorted by timestamp
     * 
     * Expected message structure (PLACEHOLDER - adjust to your unified schema):
     * {
     *   id: string,
     *   timestamp_ms: number,          // Stream-relative milliseconds
     *   type: 'chat' | 'superchat' | 'bits' | 'membership' | 'gift' | 'deleted',
     *   
     *   // Author info
     *   author: {
     *     id: string,
     *     name: string,
     *     color: string | null,        // Username color
     *     badges: string[],            // Badge IDs (filenames in assets/badges/)
     *   },
     *   
     *   // Message content
     *   content: {
     *     raw: string,                 // Original text
     *     segments: [                  // Parsed segments for rendering
     *       { type: 'text', value: string } |
     *       { type: 'emoji', id: string, name: string }  // id = filename in assets/emojis/
     *     ],
     *   },
     *   
     *   // Type-specific data
     *   superchat?: { amount: number, currency: string, tier: number },
     *   bits?: { amount: number, tier: number },
     *   membership?: { tier: string, months: number, isGift: boolean, giftCount?: number },
     *   deleted?: { deleted_at_ms: number },
     * }
     */
    this.messages = messages;
    this.currentIndex = 0;
  }

  /**
   * Get the next batch of messages
   * @param currentTimeMs - Current playback time in milliseconds
   * @returns {{ messages: Message[], nextBatchTimeMs: number | null }}
   */
  getNextBatch(currentTimeMs) {
    const batch = [];
    const windowEnd = currentTimeMs + config.BATCH_WINDOW_MS;

    while (this.currentIndex < this.messages.length) {
      const msg = this.messages[this.currentIndex];

      // Message is in the future beyond our window
      if (msg.timestamp_ms > windowEnd) {
        break;
      }

      // Message is within current time window
      if (msg.timestamp_ms <= windowEnd) {
        batch.push(msg);
        this.currentIndex++;
      }

      // Hit max batch size
      if (batch.length >= config.BATCH_MAX_MESSAGES) {
        break;
      }
    }

    // Calculate when next batch starts
    const nextBatchTimeMs = this.currentIndex < this.messages.length
      ? this.messages[this.currentIndex].timestamp_ms
      : null;

    return { messages: batch, nextBatchTimeMs };
  }

  /**
   * Peek at the next message timestamp without consuming
   */
  peekNextTimestamp() {
    if (this.currentIndex >= this.messages.length) {
      return null;
    }
    return this.messages[this.currentIndex].timestamp_ms;
  }

  /**
   * Check if there are more messages
   */
  hasMore() {
    return this.currentIndex < this.messages.length;
  }

  /**
   * Reset to beginning
   */
  reset() {
    this.currentIndex = 0;
  }

  /**
   * Get total message count
   */
  get totalMessages() {
    return this.messages.length;
  }

  /**
   * Get stream duration based on last message
   */
  get streamDurationMs() {
    if (this.messages.length === 0) return 0;
    return this.messages[this.messages.length - 1].timestamp_ms;
  }
}

module.exports = MessageBatcher;
