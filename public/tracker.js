import { encodeWav, rms, SPEECH_RATE } from './audio.js';
import { completeOnPause, hasMovedOn, matchPhrase } from './matcher.js';

const WINDOW_SECONDS = 12;
const MIN_AUDIO_SECONDS = 0.5;
const OVERLAP_SECONDS = 0.3;
const PAUSE_SECONDS = 2;
const TICK_MS = 400;
const MIN_SPEECH_LEVEL = 0.0004;

const WINDOW_SAMPLES = WINDOW_SECONDS * SPEECH_RATE;

// Follows the narrator through one phrase at a time. Audio goes to the
// recognizer as a growing window that starts where the phrase started.
export class SpeechTracker {
  constructor({ onProgress, onComplete, onError, transcribe }) {
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
    this.transcribe = transcribe;
    this.ring = new Float32Array(WINDOW_SAMPLES);
    this.total = 0;
    this.noiseFloor = 0.002;
    this.lastSpeechSample = 0;
    this.hasUnsentSpeech = false;
    this.busy = false;
    this.generation = 0;
    this.timer = null;
    this.setPhrase('');
  }

  start() {
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.generation++;
  }

  // `carry` holds words already heard that belong to this phrase. `next` is
  // the phrase after it, used to catch up if this one is misheard.
  setPhrase(phrase, { startSample = this.total, carry = '', next = '' } = {}) {
    this.phrase = phrase;
    this.next = next;
    this.windowStart = startSample;
    this.carry = carry;
    this.matched = [];
    this.generation++;
    this.hasUnsentSpeech = false;
    if (carry) this.apply(carry, this.total);
  }

  pushAudio(samples) {
    for (const sample of samples) {
      this.ring[this.total % WINDOW_SAMPLES] = sample;
      this.total++;
    }
    const level = rms(samples);
    if (level > Math.max(MIN_SPEECH_LEVEL, this.noiseFloor * 3)) {
      this.lastSpeechSample = this.total;
      this.hasUnsentSpeech = true;
    }
    // The floor falls quickly in the gaps between words and rises slowly, so
    // it settles on the room's noise for quiet and loud microphones alike.
    this.noiseFloor += (level - this.noiseFloor) * (level < this.noiseFloor ? 0.1 : 0.001);
  }

  snapshot(from, to) {
    const samples = new Float32Array(to - from);
    for (let i = from; i < to; i++) samples[i - from] = this.ring[i % WINDOW_SAMPLES];
    return samples;
  }

  async tick() {
    if (!this.phrase) return;

    const silence = (this.total - this.lastSpeechSample) / SPEECH_RATE;
    if (
      silence >= PAUSE_SECONDS &&
      !this.hasUnsentSpeech &&
      !this.busy &&
      completeOnPause(this.phrase, this.matched)
    ) {
      this.onComplete({ startSample: this.lastSpeechSample, carry: '' });
      return;
    }

    if (this.busy || !this.hasUnsentSpeech) return;
    const end = this.total;
    const start = Math.max(this.windowStart, end - WINDOW_SAMPLES + 1);
    if (end - start < MIN_AUDIO_SECONDS * SPEECH_RATE) return;

    const generation = this.generation;
    this.busy = true;
    this.hasUnsentSpeech = false;
    try {
      const wav = encodeWav(this.snapshot(start, end), SPEECH_RATE);
      const text = await this.transcribe(wav);
      if (generation === this.generation) this.apply(`${this.carry} ${text}`, end);
    } catch (error) {
      this.hasUnsentSpeech = true;
      this.onError(error);
    } finally {
      this.busy = false;
    }
  }

  apply(transcript, audioEnd) {
    const { matched, complete, remainder } = matchPhrase(this.phrase, transcript);
    if (matched.length > this.matched.length) this.matched = matched;
    this.onProgress(this.matched);
    if (complete) {
      const overlap = Math.round(OVERLAP_SECONDS * SPEECH_RATE);
      this.onComplete({ startSample: Math.max(0, audioEnd - overlap), carry: remainder });
    } else if (hasMovedOn(this.next, transcript)) {
      this.onComplete({ startSample: audioEnd, carry: transcript });
    }
  }
}
