# NPR Tracker

A web app that auto-transcribes NPR podcasts with word-level timestamps, highlights text in sync with audio playback, and lets you save vocabulary — built for English learners.

## Features

- Browse 50+ NPR podcasts organized by category (News, Politics, Culture, Science, etc.)
- Search episodes by title within any show
- AI-powered transcription using OpenAI Whisper with word-level timestamps
- Real-time transcript highlighting synced to audio playback
- Adjustable playback speed (0.75x–1.5x)
- Tap any word to save it to your vocabulary list
- Auto-bookmark your listening position, resume where you left off
- Installable as a PWA on your phone
- Transcript caching — episodes only need to be transcribed once

## Tech Stack

- **Backend:** Python, FastAPI, OpenAI Whisper, BeautifulSoup
- **Frontend:** Vanilla JavaScript (no frameworks), CSS, HTML
- **Audio:** HTML5 Audio API with server-side proxy for CORS
- **Storage:** localStorage (bookmarks, vocabulary), file-based transcript cache

## Quick Start

Prerequisites: Python 3.10+, ffmpeg

```bash
# Install ffmpeg
brew install ffmpeg        # macOS
# apt install ffmpeg       # Ubuntu/Debian

# Clone and set up
git clone https://github.com/Vanxun-Hank/npr-tracker.git
cd npr-tracker
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Run
python backend/main.py
# Open http://localhost:8000
```

The first time you open an episode, Whisper will download the model (~140MB for `base`) and transcribe the audio. This takes a few minutes. Subsequent loads are instant (cached).

## Deploy to a Cloud Server

For Ubuntu 22.04+ servers (tested on Tencent Cloud and Alibaba Cloud):

```bash
chmod +x deploy.sh
sudo ./deploy.sh
```

This installs dependencies, creates a systemd service, and starts the app on port 8000. Open firewall port 8000 (or set up Nginx on port 80).

## Project Structure

```
├── backend/
│   ├── main.py              # FastAPI server and API endpoints
│   ├── scraper.py           # NPR RSS feed parsing and episode extraction
│   ├── transcriber.py       # Whisper transcription with caching
│   ├── requirements.txt     # Python dependencies
│   └── cache/               # Cached transcripts (auto-generated)
├── frontend/
│   ├── index.html           # Single-page app shell
│   ├── css/style.css        # Mobile-first responsive styles
│   ├── js/
│   │   ├── app.js           # Main app logic and navigation
│   │   ├── player.js        # Audio playback controls
│   │   ├── transcript.js    # Transcript rendering and highlight sync
│   │   ├── vocab.js         # Vocabulary saving
│   │   └── bookmark.js      # Position bookmarking
│   ├── manifest.json        # PWA manifest
│   └── sw.js                # Service worker
└── deploy.sh                # One-command server deployment
```

## How It Works

1. **Browse:** The app fetches episode lists from NPR's RSS feeds
2. **Transcribe:** When you open an episode, the backend downloads the audio and runs it through Whisper, producing word-level timestamps
3. **Highlight:** As audio plays, the frontend matches the current playback time to transcript words and highlights the active sentence
4. **Cache:** Transcripts are saved to disk so the same episode loads instantly next time
