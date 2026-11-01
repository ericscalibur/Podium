// Decides how much of the current phrase has been spoken, given a noisy
// transcript of the most recent audio.

const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'million', 'billion', 'percent', 'dollars', 'first', 'second', 'third',
]);

export function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[\[(][^\])]*[\])]/g, ' ') // [BLANK_AUDIO], (music)
    .replace(/[‘’]/g, "'")
    .replace(/[—–-]+/g, ' ')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function isNumeric(word) {
  return /\d/.test(word) || NUMBER_WORDS.has(word);
}

function wordsMatch(expected, heard) {
  if (expected === heard) return true;
  if (isNumeric(expected) && isNumeric(heard)) return true;
  const longest = Math.max(expected.length, heard.length);
  if (longest < 4) return false;
  return editDistance(expected, heard) / longest <= 0.34;
}

// Longest-common-subsequence alignment. Returns the indices of the phrase
// words found in order, and where in the transcript the alignment ended.
function align(expected, heard) {
  const rows = expected.length + 1;
  const cols = heard.length + 1;
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = expected.length - 1; i >= 0; i--) {
    for (let j = heard.length - 1; j >= 0; j--) {
      table[i][j] = wordsMatch(expected[i], heard[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const matched = [];
  let heardEnd = 0;
  let i = 0;
  let j = 0;
  while (i < expected.length && j < heard.length) {
    if (wordsMatch(expected[i], heard[j])) {
      matched.push(i);
      i++;
      j++;
      heardEnd = j;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { matched, heardEnd };
}

export function matchPhrase(phrase, transcript) {
  const expected = normalizeWords(phrase);
  const heard = normalizeWords(transcript);
  if (!expected.length) return { matched: [], coverage: 1, complete: true, remainder: heard.join(' ') };

  const { matched, heardEnd } = align(expected, heard);
  const coverage = matched.length / expected.length;
  const lastMatched = matched.at(-1) ?? -1;
  const reachedEnd = lastMatched >= expected.length - Math.min(2, Math.ceil(expected.length / 3));
  const threshold = expected.length <= 3 ? 1 : 0.7;

  return {
    matched,
    coverage,
    complete: coverage >= threshold && reachedEnd,
    // Words past the phrase already belong to the next one.
    remainder: heard.slice(heardEnd).join(' '),
  };
}

// When the final words were garbled, a pause after nearly the whole phrase is
// the signal. Only the last few words may be missing, so a dramatic pause
// partway through does not advance.
export function completeOnPause(phrase, matched) {
  const total = normalizeWords(phrase).length;
  const remaining = total - ((matched.at(-1) ?? -1) + 1);
  return matched.length / total >= 0.7 && remaining <= Math.max(1, Math.floor(total * 0.2));
}
