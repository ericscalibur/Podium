# Podium

A voice-tracked teleprompter for narrators. Upload a script and read it one bold phrase at a time as local Whisper follows your voice, then export the recording as WAV or MP3.

> **Status:** early. Voice tracking has been tested end to end in Chrome with synthesized speech, but not yet with a live microphone.

## Features

- Splits `.txt` and `.md` scripts into natural phrases of up to 12 words
- Shows one large phrase at a time, with the next one dimmed below it
- Advances when you finish a phrase, highlighting words as they are heard
- Shows a live input meter down the right side, with a warning if the microphone goes silent
- Records one continuous take, saved to disk as you read
- Exports WAV (24-bit) or MP3 (192 kbps), plus phrase markers as an Audacity label file
- Runs on your Mac: audio is not sent to any cloud service

## Requirements

- macOS with [Homebrew](https://brew.sh)
- Node.js 20 or later
- Google Chrome

## Setup

```sh
npm run setup
```

This installs `ffmpeg` and `cmake` if they are missing, builds the whisper.cpp server into `vendor/`, then downloads the Whisper `base.en` model into `models/`.

## Usage

```sh
npm start
```

The first launch takes about 30 seconds while Whisper prepares the GPU. Open <http://localhost:4600> in Chrome, choose a script, allow microphone access and press **Begin**. Reading starts after a three-second countdown.

| Key | Action |
| --- | --- |
| `Space` or `→` | Next phrase |
| `←` | Redo previous phrase |
| `R` | Redo this phrase |
| `P` | Pause or resume |
| `Esc` | Finish the take |

Going back does not cut any audio. The earlier attempt stays in the recording, and the new one is labeled `RETAKE` in the markers so you can find it in an editor.

Takes are saved in `recordings/`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4600` | Web app port |
| `WHISPER_PORT` | `4601` | Local Whisper server port |
| `PODIUM_MODEL` | `base.en` | Whisper model, also read by `npm run setup` |

## Development

```sh
npm test
```

Podium has no npm dependencies. The server is plain Node, and the browser code lives in `public/`.
