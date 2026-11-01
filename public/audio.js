export const SPEECH_RATE = 16000;

export function rms(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export class Microphone {
  constructor(onBlock) {
    this.onBlock = onBlock;
    this.context = null;
    this.stream = null;
  }

  get sampleRate() {
    return this.context.sampleRate;
  }

  async start(deviceId) {
    await this.stop();
    // Processing is off so the recording keeps the natural voice.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.context = new AudioContext();
    await this.context.resume();
    await this.context.audioWorklet.addModule('capture-worklet.js');
    const source = this.context.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.context, 'capture-processor', { numberOfOutputs: 0 });
    node.port.onmessage = ({ data }) => this.onBlock(data);
    source.connect(node);
  }

  async stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.stream = null;
    this.context = null;
  }
}

// Averaging downsampler for the speech recognizer.
export class Downsampler {
  constructor(fromRate) {
    this.step = fromRate / SPEECH_RATE;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
  }

  process(samples) {
    const output = new Float32Array(Math.ceil(samples.length / this.step) + 1);
    let written = 0;
    for (const sample of samples) {
      this.sum += sample;
      this.count++;
      this.position++;
      if (this.position >= this.step) {
        output[written++] = this.sum / this.count;
        this.position -= this.step;
        this.sum = 0;
        this.count = 0;
      }
    }
    return output.subarray(0, written);
  }
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clipped * 0x7fff, true);
  });
  return buffer;
}
