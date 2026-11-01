const FLUSH_MS = 1000;
const RETRY_MS = 1000;

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? 'Server error');
  return response.json();
}

// Streams audio to disk as it is captured, so a long take does not live in
// browser memory and survives a closed tab.
export class Recorder {
  constructor({ onError }) {
    this.onError = onError;
    this.pending = [];
    this.frames = 0;
    this.seq = 0;
    this.draining = null;
  }

  get seconds() {
    return this.frames / this.sampleRate;
  }

  async start(sampleRate, title) {
    this.sampleRate = sampleRate;
    const { id } = await postJson('/api/sessions', { sampleRate, title });
    this.id = id;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
  }

  push(samples) {
    this.pending.push(samples.slice());
    this.frames += samples.length;
  }

  takePending() {
    const size = this.pending.reduce((sum, block) => sum + block.length, 0);
    const merged = new Float32Array(size);
    let offset = 0;
    for (const block of this.pending) {
      merged.set(block, offset);
      offset += block.length;
    }
    this.pending = [];
    return merged;
  }

  flush() {
    this.draining ??= this.drain().finally(() => (this.draining = null));
    return this.draining;
  }

  async drain() {
    while (this.pending.length) {
      const chunk = this.takePending();
      for (;;) {
        try {
          const response = await fetch(`/api/sessions/${this.id}/audio?seq=${this.seq}`, {
            method: 'POST',
            body: chunk,
          });
          if (!response.ok) throw new Error(`Upload failed (${response.status})`);
          this.seq++;
          break;
        } catch (error) {
          this.onError(error);
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    }
  }

  async finish(markers) {
    clearInterval(this.timer);
    await this.flush();
    await this.flush();
    await postJson(`/api/sessions/${this.id}/finish`, { markers });
    return this.id;
  }
}
