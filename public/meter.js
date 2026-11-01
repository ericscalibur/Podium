// Input level meter: maps audio peaks to lit segments and a plain status.

export const SEGMENTS = 30;

const FLOOR_DB = -60;
const QUIET_BELOW_DB = -30;
const HIGH_FROM_DB = -10;
const LOUD_FROM_DB = -4;
const IDLE_BELOW_DB = -50;
const DEAD_PEAK = 0.00005;
const DEAD_SECONDS = 3;
const HOLD_SECONDS = 3;
const FALL_DB_PER_SECOND = 40;

export const STATUS_TEXT = {
  dead: 'No sound',
  idle: 'Speak to test',
  quiet: 'Too quiet',
  good: 'Good',
  high: 'Almost too loud',
  loud: 'Too loud',
};

function toDb(peak) {
  return 20 * Math.log10(Math.max(peak, 1e-6));
}

export function peakOf(samples) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function zoneFor(db) {
  if (db >= LOUD_FROM_DB) return 'loud';
  if (db >= HIGH_FROM_DB) return 'high';
  if (db >= QUIET_BELOW_DB) return 'good';
  return 'quiet';
}

// Segment 0 is the bottom of the meter.
export function segmentZone(index) {
  return zoneFor(FLOOR_DB + ((index + 0.5) / SEGMENTS) * -FLOOR_DB);
}

export function litSegments(db) {
  const lit = Math.ceil(((db - FLOOR_DB) / -FLOOR_DB) * SEGMENTS);
  return Math.max(0, Math.min(SEGMENTS, lit));
}

export class LevelMonitor {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.deadSeconds = 0;
    this.displayDb = FLOOR_DB;
    this.holdDb = FLOOR_DB;
    this.holdAge = 0;
  }

  // The status follows the loudest recent peak, so it stays put between words.
  update(samples) {
    const seconds = samples.length / this.sampleRate;
    const peak = peakOf(samples);
    const db = toDb(peak);

    this.deadSeconds = peak < DEAD_PEAK ? this.deadSeconds + seconds : 0;
    this.displayDb = Math.max(db, this.displayDb - FALL_DB_PER_SECOND * seconds);

    this.holdAge += seconds;
    if (db >= this.holdDb || this.holdAge >= HOLD_SECONDS) {
      this.holdDb = db;
      this.holdAge = 0;
    }

    return { lit: litSegments(this.displayDb), status: this.status() };
  }

  status() {
    if (this.deadSeconds >= DEAD_SECONDS) return 'dead';
    return this.holdDb < IDLE_BELOW_DB ? 'idle' : zoneFor(this.holdDb);
  }
}
