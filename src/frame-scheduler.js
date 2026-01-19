/**
 * Frame Scheduler
 * Handles constant frame rate timing and frame duplication
 */

const config = require('../config');

class FrameScheduler {
  constructor(streamDurationMs) {
    this.streamDurationMs = streamDurationMs;
    this.frameDurationMs = 1000 / config.FRAMERATE;
    this.totalFrames = Math.ceil(streamDurationMs / this.frameDurationMs);
    this.currentFrame = 0;
  }

  /**
   * Get the current playback time in milliseconds
   */
  getCurrentTimeMs() {
    return this.currentFrame * this.frameDurationMs;
  }

  /**
   * Get current frame number (0-indexed)
   */
  getCurrentFrameNumber() {
    return this.currentFrame;
  }

  /**
   * Advance to next frame
   * @returns true if there are more frames, false if done
   */
  advance() {
    this.currentFrame++;
    return this.currentFrame < this.totalFrames;
  }

  /**
   * Calculate how many frames to hold current state
   * (i.e., duplicate frames until next chat event)
   * @param nextEventTimeMs - Timestamp of next chat event (or null if none)
   * @returns Number of frames to generate with current state
   */
  getFrameCountUntil(nextEventTimeMs) {
    const currentTimeMs = this.getCurrentTimeMs();
    
    // No more events - render until end of stream
    if (nextEventTimeMs === null) {
      return this.totalFrames - this.currentFrame;
    }

    // Calculate frames between now and next event
    const durationMs = nextEventTimeMs - currentTimeMs;
    const frameCount = Math.max(1, Math.floor(durationMs / this.frameDurationMs));
    
    // Don't exceed remaining frames
    return Math.min(frameCount, this.totalFrames - this.currentFrame);
  }

  /**
   * Skip ahead by N frames (after generating duplicates)
   * @param count - Number of frames to skip
   */
  skipFrames(count) {
    this.currentFrame = Math.min(this.currentFrame + count, this.totalFrames);
  }

  /**
   * Check if we've reached the end
   */
  isDone() {
    return this.currentFrame >= this.totalFrames;
  }

  /**
   * Get progress percentage
   */
  getProgress() {
    return (this.currentFrame / this.totalFrames) * 100;
  }

  /**
   * Get formatted time string for logging
   */
  getTimeString() {
    const ms = this.getCurrentTimeMs();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }

  /**
   * Get stats object
   */
  getStats() {
    return {
      currentFrame: this.currentFrame,
      totalFrames: this.totalFrames,
      currentTimeMs: this.getCurrentTimeMs(),
      streamDurationMs: this.streamDurationMs,
      framerate: config.FRAMERATE,
      progress: this.getProgress(),
    };
  }
}

module.exports = FrameScheduler;
