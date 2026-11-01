import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechTracker } from '../public/tracker.js';

const BLOCK = 683;

function tone(level) {
  const samples = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) samples[i] = level * Math.SQRT2 * Math.sin(i / 3);
  return samples;
}

function feed(tracker, level, blocks) {
  for (let i = 0; i < blocks; i++) tracker.pushAudio(tone(level));
}

function newTracker() {
  const noop = () => {};
  const tracker = new SpeechTracker({ onProgress: noop, onComplete: noop, onError: noop, transcribe: noop });
  tracker.setPhrase('a test phrase');
  return tracker;
}

test('hears speech from a very quiet microphone', () => {
  const tracker = newTracker();
  feed(tracker, 0.0001, 60);
  assert.equal(tracker.hasUnsentSpeech, false);
  feed(tracker, 0.002, 1);
  assert.equal(tracker.hasUnsentSpeech, true);
});

test('settles on steady room noise instead of treating it as speech', () => {
  const tracker = newTracker();
  feed(tracker, 0.02, 12000);
  tracker.hasUnsentSpeech = false;
  feed(tracker, 0.02, 1);
  assert.equal(tracker.hasUnsentSpeech, false);
  feed(tracker, 0.2, 1);
  assert.equal(tracker.hasUnsentSpeech, true);
});
