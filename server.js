import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const RECORDINGS_DIR = path.join(ROOT, 'recordings');

const PORT = Number(process.env.PORT ?? 4600);
const WHISPER_PORT = Number(process.env.WHISPER_PORT ?? 4601);
const MODEL = process.env.PODIUM_MODEL ?? 'base.en';
const MODEL_PATH = path.join(ROOT, 'models', `ggml-${MODEL}.bin`);
const WHISPER_URL = `http://127.0.0.1:${WHISPER_PORT}`;

const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const sessions = new Map();
let whisperProcess = null;
let whisperError = null;

function startWhisper() {
  if (!existsSync(MODEL_PATH)) {
    whisperError = `Speech model missing. Run: npm run setup`;
    return;
  }
  whisperProcess = spawn(
    'whisper-server',
    ['--model', MODEL_PATH, '--host', '127.0.0.1', '--port', String(WHISPER_PORT), '--language', 'en'],
    { stdio: 'ignore' },
  );
  whisperProcess.on('error', () => {
    whisperError = 'whisper-server not found. Run: npm run setup';
    whisperProcess = null;
  });
  whisperProcess.on('exit', (code) => {
    if (whisperProcess) whisperError = `whisper-server exited (code ${code})`;
    whisperProcess = null;
  });
}

async function whisperReady() {
  try {
    const response = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', (data) => (errors += data));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(errors || `ffmpeg exited with ${code}`)),
    );
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function transcribe(req, res) {
  const wav = await readBody(req, MAX_TRANSCRIBE_BYTES);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'window.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const response = await fetch(`${WHISPER_URL}/inference`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Whisper returned ${response.status}`);
  const { text = '' } = await response.json();
  sendJson(res, 200, { text: text.trim() });
}

function sessionDir(id) {
  return path.join(RECORDINGS_DIR, id);
}

async function createSession(req, res) {
  const { sampleRate, title } = JSON.parse(await readBody(req, MAX_JSON_BYTES));
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    return sendJson(res, 400, { error: 'Invalid sample rate' });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const id = `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(sessionDir(id), { recursive: true });
  const stream = createWriteStream(path.join(sessionDir(id), 'take.f32'));
  sessions.set(id, { sampleRate, title: String(title ?? 'take'), stream, nextSeq: 0 });
  sendJson(res, 201, { id });
}

function appendChunk(session, chunk) {
  return new Promise((resolve, reject) => {
    session.stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

async function appendAudio(req, res, session, seq) {
  const chunk = await readBody(req, MAX_AUDIO_CHUNK_BYTES);
  // A retried upload that already landed is acknowledged, not re-written.
  if (seq === session.nextSeq) {
    await appendChunk(session, chunk);
    session.nextSeq++;
  } else if (seq > session.nextSeq) {
    return sendJson(res, 409, { error: 'Out-of-order audio chunk' });
  }
  sendJson(res, 200, { ok: true });
}

function labelsFile(markers) {
  return markers
    .map(({ start, end, label }) => `${start.toFixed(3)}\t${end.toFixed(3)}\t${label}`)
    .join('\n') + '\n';
}

function parseMarkers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m) => Number.isFinite(m?.start) && Number.isFinite(m?.end))
    .map((m) => ({
      start: m.start,
      end: m.end,
      label: String(m.label ?? '').replace(/[\t\r\n]+/g, ' '),
    }));
}

async function finishSession(req, res, id, session) {
  const { markers } = JSON.parse(await readBody(req, MAX_JSON_BYTES));
  await new Promise((resolve, reject) => {
    session.stream.once('error', reject);
    session.stream.end(resolve);
  });
  const dir = sessionDir(id);
  await writeFile(path.join(dir, 'markers.txt'), labelsFile(parseMarkers(markers)));
  await writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ title: session.title, sampleRate: session.sampleRate }),
  );
  await runFfmpeg([
    '-f', 'f32le', '-ar', String(session.sampleRate), '-ac', '1',
    '-i', path.join(dir, 'take.f32'),
    '-c:a', 'pcm_s24le', path.join(dir, 'take.wav'),
  ]);
  sessions.delete(id);
  sendJson(res, 200, { id });
}

async function downloadName(id, extension) {
  const meta = JSON.parse(await readFile(path.join(sessionDir(id), 'meta.json'), 'utf8'));
  const base = meta.title.replace(/\.[^.]+$/, '').replace(/[^\w -]+/g, '').trim() || 'podium-take';
  return `${base}.${extension}`;
}

async function serveExport(req, res, id, file, download) {
  const dir = sessionDir(id);
  const wav = path.join(dir, 'take.wav');
  const target = path.join(dir, file);
  if (file === 'take.mp3' && !existsSync(target)) {
    await runFfmpeg(['-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', target]);
  }
  const { size } = await stat(target);
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain' }[path.extname(file)],
  };
  if (download) {
    const name = await downloadName(id, path.extname(file).slice(1));
    headers['Content-Disposition'] = `attachment; filename="${name}"`;
  }

  // The review player needs byte ranges to seek.
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    return createReadStream(target, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  createReadStream(target).pipe(res);
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

// Only pages served by Podium itself may reach the API. This stops any other
// website open in the browser from driving the local server.
function isTrustedRequest(req) {
  const allowedHosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || allowedHosts.includes(origin.replace(/^http:\/\//, ''));
}

async function route(req, res) {
  if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Forbidden' });
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, { speechReady: await whisperReady(), speechError: whisperError });
  }
  if (req.method === 'POST' && pathname === '/api/transcribe') return transcribe(req, res);
  if (req.method === 'POST' && pathname === '/api/sessions') return createSession(req, res);

  const audio = /^\/api\/sessions\/([\w-]+)\/audio$/.exec(pathname);
  if (req.method === 'POST' && audio) {
    const session = sessions.get(audio[1]);
    if (!session) return sendJson(res, 404, { error: 'Unknown session' });
    return appendAudio(req, res, session, Number(url.searchParams.get('seq')));
  }

  const finish = /^\/api\/sessions\/([\w-]+)\/finish$/.exec(pathname);
  if (req.method === 'POST' && finish) {
    const session = sessions.get(finish[1]);
    if (!session) return sendJson(res, 404, { error: 'Unknown session' });
    return finishSession(req, res, finish[1], session);
  }

  const exported = /^\/api\/sessions\/([\w-]+)\/(take\.wav|take\.mp3|markers\.txt)$/.exec(pathname);
  if (req.method === 'GET' && exported) {
    if (!existsSync(path.join(sessionDir(exported[1]), 'take.wav'))) {
      return sendJson(res, 404, { error: 'Unknown session' });
    }
    return serveExport(req, res, exported[1], exported[2], url.searchParams.has('download'));
  }

  if (req.method === 'GET' && !pathname.startsWith('/api/')) return serveStatic(res, pathname);
  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    if (res.headersSent) return res.destroy();
    sendJson(res, error.status ?? 500, { error: error.message });
  });
});

function shutdown() {
  const child = whisperProcess;
  whisperProcess = null;
  child?.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await mkdir(RECORDINGS_DIR, { recursive: true });
startWhisper();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Podium is running at http://localhost:${PORT}`);
});
