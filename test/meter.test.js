import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LevelMonitor, litSegments, SEGMENTS, segmentZone } from '../public/meter.js';

const RATE = 48000;
const block = (peak) => new Float32Array(2048).fill(peak);
const statusAt = (peak) => new LevelMonitor(RATE).update(block(peak)).status;

test('zones run blue, green, yellow, red from the bottom up', () => {
  const zones = Array.from({ length: SEGMENTS }, (_, i) => segmentZone(i));
  assert.deepEqual([...new Set(zones)], ['quiet', 'good', 'high', 'loud']);
  assert.equal(zones[0], 'quiet');
  assert.equal(zones.at(-1), 'loud');
});

test('lit segments scale with level and stay in range', () => {
  assert.equal(litSegments(-100), 0);
  assert.equal(litSegments(-30), SEGMENTS / 2);
  assert.equal(litSegments(0), SEGMENTS);
});

test('status reflects the level', () => {
  assert.equal(statusAt(0.0005), 'idle');
  assert.equal(statusAt(0.015), 'quiet'); // about -36 dB, a real too-quiet take
  assert.equal(statusAt(0.2), 'good');
  assert.equal(statusAt(0.45), 'high');
  assert.equal(statusAt(0.9), 'loud');
});

test('status holds between words', () => {
  const monitor = new LevelMonitor(RATE);
  monitor.update(block(0.2));
  assert.equal(monitor.update(block(0.0005)).status, 'good');
});

test('reports no sound only after sustained digital silence', () => {
  const monitor = new LevelMonitor(RATE);
  assert.notEqual(monitor.update(block(0)).status, 'dead');
  let status;
  for (let i = 0; i < 80; i++) status = monitor.update(block(0)).status;
  assert.equal(status, 'dead');
  assert.notEqual(monitor.update(block(0.0005)).status, 'dead');
});
