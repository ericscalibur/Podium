import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkScript } from '../public/chunker.js';

const words = (text) => text.split(/\s+/).length;

test('keeps paragraphs and sentences apart', () => {
  assert.deepEqual(chunkScript('Hello there, friends.\n\nWe begin today. It is time.'), [
    'Hello there, friends.',
    'We begin today.',
    'It is time.',
  ]);
});

test('caps phrase length without dropping a word', () => {
  const text =
    'The committee which had been meeting for several long months in the old town hall finally reached a decision that nobody in the room had really expected to hear.';
  const phrases = chunkScript(text);
  assert.ok(phrases.length > 1);
  assert.ok(phrases.every((phrase) => words(phrase) <= 12));
  assert.equal(phrases.join(' '), text);
});

test('does not split on abbreviations or initials', () => {
  assert.deepEqual(chunkScript('Dr. Smith met J. Doe at noon.'), ['Dr. Smith met J. Doe at noon.']);
});

test('strips markdown and handles CRLF and BOM', () => {
  assert.deepEqual(chunkScript('﻿# Opening\r\n\r\nThis is **very** important.'), [
    'Opening',
    'This is very important.',
  ]);
});

test('an empty script has no phrases', () => {
  assert.deepEqual(chunkScript('  \n\n '), []);
});
