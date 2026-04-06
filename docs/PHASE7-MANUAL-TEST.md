# Phase 7 — Transcription manual testing guide

Transcription uses **OpenAI Whisper** via the API. You need an **OpenAI API key** (same key used for other OpenAI APIs).

---

## Getting an OpenAI API key

1. Go to [platform.openai.com](https://platform.openai.com) and sign in or create an account.
2. **API Keys** → **Create new secret key**. Copy the key (it starts with `sk-`).
3. **Store it** — Create a `.env` file in the project root (copy from `.env.example`):
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```
   The project loads `.env` automatically. Do not commit `.env` (it's in `.gitignore`).

**Free credits:** New accounts receive **$5 in free credits** (no credit card required initially; credits expire after a few months). Whisper costs about **$0.006 per minute** of audio, so $5 ≈ 800+ minutes of transcription. See [OpenAI pricing](https://developers.openai.com/api/docs/pricing) for current rates.

---

## Prerequisites

1. **API key:** In project root, create `.env` with `OPENAI_API_KEY=sk-...` (see [Getting an OpenAI API key](#getting-an-openai-api-key)).
2. **Config:** `config/local.yaml` with `vault_path` (see [PHASE4-MANUAL-TEST.md](./PHASE4-MANUAL-TEST.md)).
3. **Audio/video file:** Formats supported by Whisper: mp3, mp4, mpeg, mpga, m4a, wav, webm.
4. **Optional — oversized files (self-hosted):** OpenAI rejects uploads over **~25 MB**. If **ffmpeg** is installed ([download](https://ffmpeg.org/download.html)) and `transcription.transcode_oversized` is not `false`, Knowtation will try to transcode to a smaller M4A before calling Whisper. Set `KNOWTATION_TRANSCODE_OVERSIZED=0` or `FFMPEG_PATH` as needed. Hosted serverless typically has no ffmpeg—compress locally or import Markdown.

---

## Test via `import` (recommended)

```bash
# Transcribe and write to vault inbox
node cli/index.mjs import audio /path/to/recording.m4a

# With project and output dir
node cli/index.mjs import audio ./my-podcast.mp3 --project born-free --output-dir media/audio

# Video (same pipeline)
node cli/index.mjs import video ./meeting.mp4 --output-dir media/video
```

**Expected:** A vault note with frontmatter `source: audio` (or `video`), `source_id`, `date`, and body = transcript text.

---

## Test via standalone script

```bash
# Print transcript to stdout
node scripts/transcribe.mjs /path/to/recording.mp3

# Write directly to vault
node scripts/transcribe.mjs /path/to/recording.mp3 --write media/audio/recording.md
```

---

## Without OPENAI_API_KEY

If the key is not set, you'll get:
```
OPENAI_API_KEY is required for transcription. Set it in the environment or config.
```

---

## Quick smoke test

From repo root (with a small test file):

```bash
# Create a minimal silent audio (or use any real audio file)
# If you have ffmpeg: ffmpeg -f lavfi -i anullsrc=d=1 -acodec libmp3lame -y /tmp/silent.mp3

# Or use any existing audio file
node cli/index.mjs import audio /path/to/any.mp3 --output-dir media/audio --json
```

---

## Wearables / real-time

For real-time transcripts (Omi, TranscribeGlass, etc.), use the **capture webhook** (Phase 5): have the device or app POST the transcript to `capture-webhook` with `source: audio` or `source: wearable`. No separate transcription pipeline needed for live input.
