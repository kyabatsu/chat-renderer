/**
 * Chat State Manager
 * Manages the visible message buffer and line calculations
 */

const config = require('../config');

class ChatState {
  constructor() {
    this.visibleMessages = [];
    this.totalLineCount = 0;
  }

  /**
   * Calculate how many lines a message will occupy
   * @param message - Unified message object
   * @param containerWidth - Available width for text
   * @returns number of lines
   */
  calculateMessageLines(message, containerWidth = config.OUTPUT_WIDTH - (config.HORIZONTAL_PADDING_PX * 2)) {
    // TODO: This is a rough estimate. For accurate calculation,
    // you'd need to measure actual rendered text width.
    // For now, estimate based on character count and average char width.

    const AVG_CHAR_WIDTH_PX = config.FONT_SIZE_PX * 0.55; // Rough estimate
    const BADGE_WIDTH_PX = config.FONT_SIZE_PX + 4;       // Badge + small gap
    const EMOJI_WIDTH_PX = config.FONT_SIZE_PX + 2;

    let contentWidth = 0;

    // Account for badges
    if (message.author?.badges) {
      contentWidth += message.author.badges.length * BADGE_WIDTH_PX;
    }

    // Account for username + colon + space
    if (message.author?.name) {
      contentWidth += (message.author.name.length + 2) * AVG_CHAR_WIDTH_PX;
    }

    // Account for message content
    if (message.content?.segments) {
      for (const segment of message.content.segments) {
        if (segment.type === 'text') {
          contentWidth += segment.value.length * AVG_CHAR_WIDTH_PX;
        } else if (segment.type === 'emoji') {
          contentWidth += EMOJI_WIDTH_PX;
        }
      }
    }

    // Special message types may have extra content
    if (message.type === 'superchat' || message.type === 'bits') {
      contentWidth += 100; // Rough estimate for amount badge
    }

    const lines = Math.ceil(contentWidth / containerWidth);
    return Math.max(1, lines);
  }

  /**
   * Add messages to the visible buffer
   * @param messages - Array of messages to add
   */
  addMessages(messages) {
    for (const msg of messages) {
      const lineCount = this.calculateMessageLines(msg);
      
      this.visibleMessages.push({
        ...msg,
        _lineCount: lineCount,
      });
      
      this.totalLineCount += lineCount;
    }

    // Trim old messages that have scrolled off
    this._trimOverflow();
  }

  /**
   * Mark a message as deleted
   * @param messageId - ID of message to mark deleted
   */
  markDeleted(messageId) {
    const msg = this.visibleMessages.find(m => m.id === messageId);
    if (msg) {
      msg._deleted = true;
    }
  }

  /**
   * Remove messages that have scrolled off the top
   */
  _trimOverflow() {
    while (this.totalLineCount > config.MAX_VISIBLE_LINES && this.visibleMessages.length > 0) {
      const removed = this.visibleMessages.shift();
      this.totalLineCount -= removed._lineCount;
    }
  }

  /**
   * Get current visible messages for rendering
   * @returns Array of messages with metadata
   */
  getVisibleMessages() {
    return this.visibleMessages;
  }

  /**
   * Get serializable state for passing to renderer
   */
  getState() {
    return {
      messages: this.visibleMessages,
      totalLines: this.totalLineCount,
      maxLines: config.MAX_VISIBLE_LINES,
    };
  }

  /**
   * Clear all messages
   */
  clear() {
    this.visibleMessages = [];
    this.totalLineCount = 0;
  }
}

module.exports = ChatState;
