import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeOnPause, matchPhrase, normalizeWords } from '../public/matcher.js';

const phrase = 'We choose to go to the moon in this decade';

test('normalizes punctuation, case, hyphens and non-speech tags', () => {
  assert.deepEqual(normalizeWords("[BLANK_AUDIO] Don't well-known!"), ['dont', 'well', 'known']);
});

test('a partial reading is not complete', () => {
  const result = matchPhrase(phrase, 'We choose to go');
  assert.equal(result.complete, false);
  assert.deepEqual(result.matched, [0, 1, 2, 3]);
});

test('a full reading completes despite a mistranscribed word', () => {
  assert.equal(matchPhrase(phrase, 'we chose to go to the moon in this decade').complete, true);
});

test('words past the phrase are carried to the next phrase', () => {
  const { complete, remainder } = matchPhrase('The ship has sailed', 'the ship has sailed and now we');
  assert.equal(complete, true);
  assert.equal(remainder, 'and now we');
});

test('numbers match whether written as digits or words', () => {
  assert.equal(matchPhrase('It cost five dollars in total', 'it cost $5 in total').complete, true);
});

test('unrelated speech does not complete', () => {
  assert.equal(matchPhrase(phrase, 'sorry let me try that again from the top').complete, false);
});

test('a short phrase must be heard in full', () => {
  assert.equal(matchPhrase('Thank you all', 'thank you').complete, false);
  assert.equal(matchPhrase('Thank you all', 'thank you all').complete, true);
});

test('a pause only completes a mostly-read phrase', () => {
  assert.equal(completeOnPause(phrase, [0, 1, 2, 3]), false);
  assert.equal(completeOnPause(phrase, [0, 1, 2, 3, 4, 5, 6, 7]), true);
});
