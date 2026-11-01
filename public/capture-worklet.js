const BLOCK_FRAMES = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(BLOCK_FRAMES);
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    let offset = 0;
    while (offset < samples.length) {
      const count = Math.min(samples.length - offset, BLOCK_FRAMES - this.filled);
      this.block.set(samples.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === BLOCK_FRAMES) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK_FRAMES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
