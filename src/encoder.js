/**
 * Encoder
 * FFmpeg process management for H.264 output
 */

const { spawn } = require('child_process');
const config = require('../config');

class Encoder {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this.ffmpeg = null;
    this.frameCount = 0;
    this.closed = false;
  }

  /**
   * Start FFmpeg process
   * Accepts PNG frames via stdin, outputs H.264 MP4
   */
  start() {
    const args = [
      // Input: PNG images from stdin
      '-f', 'image2pipe',
      '-framerate', config.FRAMERATE.toString(),
      '-i', '-',

      // Video codec settings
      '-c:v', config.OUTPUT_CODEC,
      '-preset', config.OUTPUT_PRESET,
      '-crf', config.OUTPUT_CRF.toString(),

      // Pixel format (required for H.264 compatibility)
      '-pix_fmt', 'yuv420p',

      // Ensure CFR output
      '-vsync', 'cfr',
      '-r', config.FRAMERATE.toString(),

      // Overwrite output
      '-y',

      this.outputPath,
    ];

    console.log(`[Encoder] Starting FFmpeg: ${config.FFMPEG_PATH} ${args.join(' ')}`);

    this.ffmpeg = spawn(config.FFMPEG_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.ffmpeg.stdout.on('data', (data) => {
      // FFmpeg outputs progress info on stderr, not stdout
    });

    this.ffmpeg.stderr.on('data', (data) => {
      // Uncomment for debug output:
      // process.stderr.write(data);
    });

    this.ffmpeg.on('error', (err) => {
      console.error(`[Encoder] FFmpeg error: ${err.message}`);
    });

    this.ffmpeg.on('close', (code) => {
      this.closed = true;
      if (code === 0) {
        console.log(`[Encoder] FFmpeg finished successfully. Total frames: ${this.frameCount}`);
      } else {
        console.error(`[Encoder] FFmpeg exited with code ${code}`);
      }
    });
  }

  /**
   * Write a PNG frame to FFmpeg
   * @param pngBuffer - PNG image buffer
   */
  async writeFrame(pngBuffer) {
    if (this.closed || !this.ffmpeg) {
      throw new Error('Encoder not running');
    }

    return new Promise((resolve, reject) => {
      const canContinue = this.ffmpeg.stdin.write(pngBuffer, (err) => {
        if (err) {
          reject(err);
        } else {
          this.frameCount++;
          resolve();
        }
      });

      // Handle backpressure
      if (!canContinue) {
        this.ffmpeg.stdin.once('drain', resolve);
      }
    });
  }

  /**
   * Write the same frame multiple times (for CFR padding)
   * @param pngBuffer - PNG image buffer
   * @param count - Number of times to write
   */
  async writeFrameRepeat(pngBuffer, count) {
    for (let i = 0; i < count; i++) {
      await this.writeFrame(pngBuffer);
    }
  }

  /**
   * Finish encoding and close FFmpeg
   */
  async finish() {
    if (this.closed || !this.ffmpeg) {
      return;
    }

    return new Promise((resolve) => {
      this.ffmpeg.stdin.end();
      this.ffmpeg.on('close', () => {
        resolve();
      });
    });
  }

  /**
   * Get encoding stats
   */
  getStats() {
    return {
      framesWritten: this.frameCount,
      outputPath: this.outputPath,
      closed: this.closed,
    };
  }
}

module.exports = Encoder;
