#!/usr/bin/env bash
# Start LensMate: offline speech service (optional) + web server. Ollama must already be running.
cd "$(dirname "$0")"
if [ -x .venv/bin/python ]; then
  .venv/bin/python stt_server.py & STT_PID=$!
  trap 'kill $STT_PID 2>/dev/null' EXIT
else
  echo "(no .venv: offline mic disabled; see README 'Offline speech')"
fi
node server.js
