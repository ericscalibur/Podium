// Splits a script into phrases a narrator can read in one breath.

const MAX_WORDS = 12;
const MIN_WORDS = 3;

const ABBREVIATIONS = /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no)\.$/i;
const INITIAL = /(?:^|\s)[A-Z]\.$/;
const CLAUSE_END = /[,;:—–]$|\s-$/;
const CONJUNCTIONS = new Set([
  'and', 'but', 'or', 'so', 'yet', 'because', 'although', 'though', 'while',
  'when', 'which', 'that', 'who', 'where', 'if', 'as', 'than', 'until',
]);
const PREPOSITIONS = new Set([
  'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'of', 'into', 'over',
  'under', 'through', 'after', 'before', 'between', 'against', 'during',
]);

function stripMarkdown(text) {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*/g, '$1$2')
    .replace(/(^|\s)_(\S(?:.*?\S)?)_/g, '$1$2');
}

function splitSentences(paragraph) {
  const sentences = [];
  let start = 0;
  const boundary = /[.!?…]+["'”’)\]]*(?=\s+|$)/g;
  let match;
  while ((match = boundary.exec(paragraph))) {
    const end = match.index + match[0].length;
    const candidate = paragraph.slice(start, end);
    if (match[0] === '.' && (ABBREVIATIONS.test(candidate) || INITIAL.test(candidate))) continue;
    sentences.push(candidate.trim());
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

function bareWord(word) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

// Lower scores make better breaks. Prefer clause punctuation, then the word
// before a conjunction, then a preposition; among equals, prefer the middle.
function breakCost(words, afterIndex) {
  const count = afterIndex + 1;
  const balance = Math.abs(count - words.length / 2) / words.length;
  if (CLAUSE_END.test(words[afterIndex])) return balance;
  const next = bareWord(words[afterIndex + 1]);
  if (CONJUNCTIONS.has(next)) return 1 + balance;
  if (PREPOSITIONS.has(next)) return 2 + balance;
  return 3 + balance;
}

function splitLong(words) {
  if (words.length <= MAX_WORDS) return [words.join(' ')];
  let best = -1;
  let bestCost = Infinity;
  for (let i = MIN_WORDS - 1; i < words.length - MIN_WORDS; i++) {
    const cost = breakCost(words, i);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return [
    ...splitLong(words.slice(0, best + 1)),
    ...splitLong(words.slice(best + 1)),
  ];
}

function splitSentence(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const clauses = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (CLAUSE_END.test(word) && current.length >= MIN_WORDS) {
      clauses.push(current);
      current = [];
    }
  }
  if (current.length) {
    if (current.length < MIN_WORDS && clauses.length) clauses.at(-1).push(...current);
    else clauses.push(current);
  }

  // Rejoin clauses that comfortably fit together so the delivery does not
  // become choppy at every comma.
  const merged = [];
  for (const clause of clauses) {
    const previous = merged.at(-1);
    if (previous && previous.length + clause.length <= MAX_WORDS && previous.length < 5) {
      previous.push(...clause);
    } else {
      merged.push([...clause]);
    }
  }
  return merged.flatMap(splitLong);
}

export function chunkScript(text) {
  return stripMarkdown(text.replace(/\r\n?/g, '\n').replace(/^﻿/, ''))
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap(splitSentences)
    .flatMap(splitSentence);
}
