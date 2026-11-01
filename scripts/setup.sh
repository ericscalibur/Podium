#!/usr/bin/env bash
# One-time setup: builds the Whisper server and downloads the speech model.
set -euo pipefail
cd "$(dirname "$0")/.."

WHISPER_VERSION="v1.9.5"
WHISPER_DIR="vendor/whisper.cpp"
WHISPER_BIN="${WHISPER_DIR}/build/bin/whisper-server"
MODEL="${PODIUM_MODEL:-base.en}"
MODEL_FILE="models/ggml-${MODEL}.bin"

command -v ffmpeg >/dev/null || brew install ffmpeg
command -v cmake >/dev/null || brew install cmake

# Built from source because the Homebrew formula's dependencies can take hours
# to compile on macOS versions without prebuilt packages.
if [[ ! -x "$WHISPER_BIN" ]]; then
  if [[ ! -d "$WHISPER_DIR" ]]; then
    git clone --depth 1 --branch "$WHISPER_VERSION" \
      https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
  fi
  cmake -S "$WHISPER_DIR" -B "${WHISPER_DIR}/build" -DCMAKE_BUILD_TYPE=Release \
    -DWHISPER_BUILD_TESTS=OFF
  cmake --build "${WHISPER_DIR}/build" --target whisper-server -j
fi

if [[ ! -f "$MODEL_FILE" ]]; then
  echo "Downloading Whisper model ${MODEL}..."
  mkdir -p models
  curl -fL --progress-bar -o "${MODEL_FILE}.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"
  mv "${MODEL_FILE}.part" "$MODEL_FILE"
fi

echo "Setup complete. Run: npm start"
