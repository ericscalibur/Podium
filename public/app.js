import { Downsampler, Microphone } from './audio.js';
import { chunkScript } from './chunker.js';
import { normalizeWords } from './matcher.js';
import { LevelMonitor, SEGMENTS, segmentZone, STATUS_TEXT } from './meter.js';
import { Recorder } from './recorder.js';
import { SpeechTracker } from './tracker.js';

const COUNTDOWN_SECONDS = 3;
const ROOM_TONE_MS = 1500;
const STATUS_POLL_MS = 2000;

const $ = (id) => document.getElementById(id);

const state = {
  title: 'take',
  phrases: [],
  startIndex: 0,
  index: 0,
  mode: 'setup', // setup | countdown | reading | paused | finishing
  speechReady: false,
  recorder: null,
  markers: [],
  seen: new Set(),
  retakes: 0,
  wordTokens: [],
};

const mic = new Microphone(handleAudioBlock);
let downsampler = null;
let micOpening = Promise.resolve();
let levelMonitor = null;
let litCount = -1;
let levelStatus = null;
let reviewedTake = null;
const tracker = new SpeechTracker({
  transcribe,
  onProgress: showSpokenWords,
  onComplete: ({ startSample, carry }) => advance({ startSample, carry }),
  onError: () => showNotice('Speech recognition is not responding. Use Space to advance.'),
});

async function transcribe(wav) {
  const response = await fetch('/api/transcribe', { method: 'POST', body: wav });
  if (!response.ok) throw new Error('Transcription failed');
  return (await response.json()).text;
}

function storedSize() {
  try {
    return localStorage.getItem('podium-size');
  } catch {
    return null;
  }
}

function storeSize(value) {
  try {
    localStorage.setItem('podium-size', value);
  } catch {
    // Only a convenience; the default size still works.
  }
}

function applySize(value) {
  document.documentElement.style.setProperty('--phrase-size', `${value}vw`);
}

function showNotice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function showScreen(name) {
  for (const id of ['setup', 'stage', 'review']) $(id).hidden = id !== name;
}

// Reading and reviewing sit one history entry above setup, so the browser's
// Back button stays inside Podium.
function returnToSetup() {
  $('player').removeAttribute('src');
  showScreen('setup');
  if (history.state?.view) history.back();
}

function handleHistoryBack(event) {
  if (state.mode === 'reading' || state.mode === 'paused') {
    // Back during a take saves it and shows the review screen.
    history.pushState({ view: 'review' }, '');
    finish();
  } else if (state.mode === 'countdown') {
    finish();
  } else if (state.mode === 'finishing') {
    history.pushState({ view: 'review' }, '');
  } else if (!event.state?.view) {
    returnToSetup();
  }
}

function clearScript() {
  state.title = 'take';
  state.phrases = [];
  state.startIndex = 0;
  $('file').value = '';
  $('drop-title').textContent = 'Choose a script';
  $('drop-detail').textContent = 'or drop a .txt or .md file here';
  $('ready').hidden = true;
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

async function pollStatus() {
  try {
    const { speechReady, speechError } = await (await fetch('/api/status')).json();
    state.speechReady = speechReady;
    if (speechReady) return;
    showNotice(speechError ?? 'Loading the speech model…');
  } catch {
    showNotice('Cannot reach the Podium server. Is it still running?');
  }
  setTimeout(pollStatus, STATUS_POLL_MS);
}

function loadScript(name, text) {
  const phrases = chunkScript(text);
  if (!phrases.length) {
    showNotice(`${name} has no readable text.`);
    return;
  }
  showNotice('');
  state.title = name;
  state.phrases = phrases;
  state.startIndex = 0;
  $('drop-title').textContent = name;
  $('drop-detail').textContent = 'Choose a different script';
  $('count').textContent = `${phrases.length} phrases`;
  renderPhraseList();
  $('ready').hidden = false;
}

function renderPhraseList() {
  const items = state.phrases.map((phrase, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const number = document.createElement('span');
    number.textContent = index + 1;
    button.append(number, phrase);
    button.className = index === state.startIndex ? 'start' : '';
    button.addEventListener('click', () => {
      state.startIndex = index;
      renderPhraseList();
    });
    item.append(button);
    return item;
  });
  $('phrases').replaceChildren(...items);
}

async function openMicrophone(deviceId) {
  try {
    await mic.start(deviceId);
    downsampler = new Downsampler(mic.sampleRate);
    levelMonitor = new LevelMonitor(mic.sampleRate);
    await listMicrophones(deviceId);
  } catch (error) {
    downsampler = null;
    showLevelStatus('dead', 'Mic blocked');
    showNotice(`Microphone unavailable: ${error.message}`);
  }
}

async function listMicrophones(selected) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const options = devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || 'Microphone';
      return option;
    });
  $('mic').replaceChildren(...options);
  if (selected) $('mic').value = selected;
}

function buildLevelMeter() {
  const segments = Array.from({ length: SEGMENTS }, (_, index) => {
    const segment = document.createElement('i');
    segment.className = segmentZone(index);
    return segment;
  });
  $('level-meter').replaceChildren(...segments);
}

function showLevelStatus(status, text) {
  $('level-status').textContent = text;
  $('level-status').className = `level-status ${status}`;
}

function renderLevel({ lit, status }) {
  if (lit !== litCount) {
    [...$('level-meter').children].forEach((segment, index) => {
      segment.classList.toggle('on', index < lit);
    });
    litCount = lit;
  }
  if (status !== levelStatus) {
    showLevelStatus(status, STATUS_TEXT[status]);
    $('mic-warning').hidden = status !== 'dead';
    levelStatus = status;
  }
}

function handleAudioBlock(block) {
  renderLevel(levelMonitor.update(block));

  if (state.mode === 'paused' || state.mode === 'setup') return;
  if (state.mode === 'countdown') return;

  state.recorder?.push(block);
  tracker.pushAudio(downsampler.process(block));
  if (state.recorder) $('clock').textContent = formatTime(state.recorder.seconds);
}

function renderPhrase() {
  const phrase = state.phrases[state.index];
  // Display tokens and matcher words differ for hyphenated text, so record
  // which display token each matcher word belongs to.
  const elements = [];
  state.wordTokens = [];
  phrase.split(/\s+/).forEach((token, tokenIndex) => {
    const span = document.createElement('span');
    span.textContent = token;
    if (tokenIndex) elements.push(' ');
    elements.push(span);
    for (let i = 0; i < normalizeWords(token).length; i++) state.wordTokens.push(span);
  });
  $('current').replaceChildren(...elements);
  $('next').textContent = state.phrases[state.index + 1] ?? '';
  $('position').textContent = `${state.index + 1} / ${state.phrases.length}`;
  $('progress').style.width = `${(state.index / state.phrases.length) * 100}%`;
}

function showSpokenWords(matched) {
  for (const wordIndex of matched) state.wordTokens[wordIndex]?.classList.add('spoken');
}

function closeMarker() {
  const seconds = state.recorder?.seconds ?? 0;
  const open = state.markers.at(-1);
  if (open && open.end === null) open.end = seconds;
}

function enterPhrase(index, trackerOptions) {
  closeMarker();
  state.index = index;
  const retake = state.seen.has(index);
  state.seen.add(index);
  if (retake) state.retakes++;
  if (state.recorder) {
    const label = `${retake ? 'RETAKE ' : ''}${index + 1}: ${state.phrases[index]}`;
    state.markers.push({ start: state.recorder.seconds, end: null, label });
  }
  renderPhrase();
  tracker.setPhrase(state.phrases[index], { ...trackerOptions, next: state.phrases[index + 1] });
}

function advance(trackerOptions) {
  if (state.mode !== 'reading') return;
  if (state.index + 1 >= state.phrases.length) return finish();
  enterPhrase(state.index + 1, trackerOptions);
}

function goTo(index) {
  if (state.mode !== 'reading' && state.mode !== 'paused') return;
  enterPhrase(Math.max(0, Math.min(index, state.phrases.length - 1)));
}

function togglePause() {
  if (state.mode !== 'reading' && state.mode !== 'paused') return;
  const pausing = state.mode === 'reading';
  state.mode = pausing ? 'paused' : 'reading';
  $('rec').classList.toggle('paused', pausing);
  $('overlay').className = 'overlay message';
  $('overlay').textContent = 'Paused. Press P to resume.';
  $('overlay').hidden = !pausing;
  if (!pausing) tracker.setPhrase(state.phrases[state.index], { next: state.phrases[state.index + 1] });
}

async function runCountdown() {
  $('overlay').className = 'overlay';
  $('overlay').hidden = false;
  for (let second = COUNTDOWN_SECONDS; second > 0; second--) {
    $('overlay').textContent = second;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (state.mode !== 'countdown') return;
  }
  $('overlay').hidden = true;
}

async function begin() {
  await micOpening;
  if (!downsampler) return showNotice('Choose a working microphone first.');
  showNotice('');
  state.mode = 'countdown';
  state.markers = [];
  state.seen = new Set();
  state.retakes = 0;
  state.recorder = null;
  state.index = state.startIndex;
  document.activeElement?.blur();

  const recording = $('record').checked;
  $('rec').classList.toggle('off', !recording);
  $('rec').classList.remove('paused');
  $('clock').textContent = recording ? '0:00' : 'Not recording';
  showScreen('stage');
  history.pushState({ view: 'stage' }, '');
  renderPhrase();

  try {
    if (recording) {
      const recorder = new Recorder({
        onError: () => {
          $('clock').textContent = 'Saving audio failed. Retrying…';
        },
      });
      await recorder.start(mic.sampleRate, state.title);
      state.recorder = recorder;
    }
  } catch (error) {
    state.mode = 'setup';
    returnToSetup();
    showNotice(`Could not start recording: ${error.message}`);
    return;
  }

  await runCountdown();
  if (state.mode !== 'countdown') return;
  state.mode = 'reading';
  enterPhrase(state.startIndex);
  tracker.start();
}

async function finish() {
  if (state.mode === 'finishing') return;
  const wasCountdown = state.mode === 'countdown';
  state.mode = 'finishing';
  tracker.stop();
  $('progress').style.width = '100%';

  if (wasCountdown) {
    state.recorder = null;
    $('overlay').hidden = true;
    state.mode = 'setup';
    returnToSetup();
    return;
  }
  $('overlay').className = 'overlay message';
  $('overlay').textContent = 'Saving…';
  $('overlay').hidden = false;

  const recorder = state.recorder;
  if (!recorder) return showReview(null);

  // Keep the room tone after the final word.
  await new Promise((resolve) => setTimeout(resolve, ROOM_TONE_MS));
  closeMarker();
  try {
    showReview(await recorder.finish(state.markers), recorder.seconds);
  } catch (error) {
    $('overlay').textContent = `Could not save the take: ${error.message}`;
  }
}

function showReview(id, seconds = 0) {
  state.mode = 'setup';
  state.recorder = null;
  $('overlay').hidden = true;
  reviewedTake = id;
  $('review-audio').hidden = !id;
  $('delete').hidden = !id;
  resetDeleteButton();
  const retakes = `${state.retakes} ${state.retakes === 1 ? 'retake' : 'retakes'}`;
  $('review-detail').textContent = id ? `${formatTime(seconds)} recorded, ${retakes}.` : 'Nothing was recorded.';
  if (id) {
    const base = `/api/sessions/${id}`;
    $('player').src = `${base}/take.wav`;
    $('wav').href = `${base}/take.wav?download`;
    $('mp3').href = `${base}/take.mp3?download`;
    $('labels').href = `${base}/markers.txt?download`;
  }
  showScreen('review');
}

function resetDeleteButton() {
  $('delete').textContent = 'Delete recording';
  $('delete').classList.remove('confirming');
}

// The first click arms the button; only the second deletes.
async function deleteTake() {
  if (!$('delete').classList.contains('confirming')) {
    $('delete').textContent = 'Really delete? This cannot be undone';
    $('delete').classList.add('confirming');
    return;
  }
  $('player').removeAttribute('src');
  const response = await fetch(`/api/sessions/${reviewedTake}`, { method: 'DELETE' });
  if (!response.ok) {
    $('review-detail').textContent = 'Could not delete the recording.';
    resetDeleteButton();
    return;
  }
  returnToSetup();
  showNotice('Recording deleted.');
}

async function readFile(file) {
  if (!file) return;
  loadScript(file.name, await file.text());
  // Lets the same file be chosen again after New script.
  $('file').value = '';
}

$('file').addEventListener('change', (event) => readFile(event.target.files[0]));

for (const type of ['dragenter', 'dragover']) {
  $('drop').addEventListener(type, (event) => {
    event.preventDefault();
    $('drop').classList.add('over');
  });
}
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop').classList.remove('over');
  readFile(event.dataTransfer.files[0]);
});

$('mic').addEventListener('change', (event) => {
  micOpening = openMicrophone(event.target.value);
});
$('size').addEventListener('input', (event) => {
  applySize(event.target.value);
  storeSize(event.target.value);
});
$('begin').addEventListener('click', begin);
$('delete').addEventListener('click', deleteTake);
$('delete').addEventListener('blur', resetDeleteButton);
$('again').addEventListener('click', returnToSetup);
$('new-script').addEventListener('click', () => {
  clearScript();
  returnToSetup();
});
window.addEventListener('popstate', handleHistoryBack);

const stageKeys = {
  ' ': () => advance(),
  ArrowRight: () => advance(),
  ArrowLeft: () => goTo(state.index - 1),
  r: () => goTo(state.index),
  p: togglePause,
  Escape: finish,
};

document.addEventListener('keydown', (event) => {
  if (state.mode === 'setup' || event.metaKey || event.ctrlKey || event.altKey) return;
  const action = stageKeys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!action) return;
  event.preventDefault();
  if (!event.repeat) action();
});

const savedSize = storedSize();
if (savedSize) {
  $('size').value = savedSize;
  applySize(savedSize);
}
buildLevelMeter();
micOpening = openMicrophone();
pollStatus();
