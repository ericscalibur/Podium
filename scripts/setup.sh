#!/usr/bin/env bash
# One-time setup: installs whisper.cpp and downloads the speech model.
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL="${PODIUM_MODEL:-base.en}"
MODEL_FILE="models/ggml-${MODEL}.bin"

command -v ffmpeg >/dev/null || brew install ffmpeg
command -v whisper-server >/dev/null || brew install whisper-cpp

if [[ ! -f "$MODEL_FILE" ]]; then
  echo "Downloading Whisper model ${MODEL}..."
  curl -fL --progress-bar -o "${MODEL_FILE}.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"
  mv "${MODEL_FILE}.part" "$MODEL_FILE"
fi

echo "Setup complete. Run: npm start"
