"""
Whisper Transcription Module
============================
This module uses OpenAI's Whisper AI model to transcribe audio into
text with word-level timestamps. This is the magic that makes
auto-highlighting work!

You'll learn: AI model usage, audio processing, file caching, JSON.
"""

import whisper
import json
import os
import tempfile
import hashlib
import httpx
import asyncio
import logging
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Directory where we cache transcription results
# So we don't re-transcribe the same episode twice (it takes minutes!)
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# ─── Singleton Model Loading ────────────────────────────────
# Loading a Whisper model takes several seconds and uses ~150MB of RAM.
# We load it ONCE and reuse it for all requests — this is called the
# "singleton pattern". Without this, each request would waste time
# reloading the model from disk.
_whisper_model = None


def get_whisper_model():
    """Load the Whisper model once, reuse for all transcriptions."""
    global _whisper_model
    if _whisper_model is None:
        print("Loading Whisper model (this only happens once)...")
        _whisper_model = whisper.load_model("small")
        print("Whisper model loaded!")
    return _whisper_model


def get_cache_path(episode_id: str) -> str:
    """Get the file path for a cached transcript."""
    # Sanitize the ID to make it safe as a filename
    safe_id = hashlib.md5(episode_id.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{safe_id}.json")


def load_from_cache(episode_id: str) -> dict | None:
    """
    Try to load a previously cached transcript.
    Returns None if not cached yet or if the cache file is corrupted.
    """
    path = get_cache_path(episode_id)
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            # Cache file is corrupted — delete it so we can re-transcribe
            logger.warning("Corrupted cache file for %s, deleting", episode_id)
            os.unlink(path)
    return None


def save_to_cache(episode_id: str, data: dict) -> None:
    """
    Save transcript data to cache for future use.
    Uses atomic write (temp file + rename) to prevent corruption
    if the process is interrupted mid-write.
    """
    path = get_cache_path(episode_id)
    # Write to a temp file first, then atomically rename
    tmp_fd, tmp_path = tempfile.mkstemp(dir=CACHE_DIR, suffix=".tmp")
    try:
        with os.fdopen(tmp_fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)  # Atomic on POSIX systems
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


async def download_audio(audio_url: str) -> str:
    """
    Download audio file to a temporary location.
    Returns the path to the downloaded file.

    We use a temp directory so the file is cleaned up automatically.
    """
    # SECURITY: Only download from known NPR audio hosts
    # This prevents SSRF — where an attacker tricks our server into
    # fetching internal resources by passing a malicious URL
    parsed = urlparse(audio_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid URL scheme: {parsed.scheme}")

    ALLOWED_HOSTS = {
        "media.npr.org", "ondemand.npr.org", "play.podtrac.com",
        "pd.npr.org", "npr.org", "npr.simplecastaudio.com",
        "prfx.byspotify.com",
        "tracking.swap.fm",             # WAMU/NPR show audio tracker
        "dcs.megaphone.fm",             # Megaphone CDN (some NPR shows)
        "traffic.megaphone.fm",         # Megaphone traffic redirect
    }
    if parsed.hostname and not any(
        parsed.hostname == host or parsed.hostname.endswith("." + host)
        for host in ALLOWED_HOSTS
    ):
        raise ValueError(f"Audio host not allowed: {parsed.hostname}")

    # Determine file extension from URL path (not substring matching!)
    # This matters because ffmpeg uses the extension for format detection
    _, ext = os.path.splitext(parsed.path.split("?")[0])
    suffix = ext if ext in (".mp3", ".wav", ".aac", ".m4a", ".ogg") else ".mp3"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        async with httpx.AsyncClient(proxy=None) as client:
            # Stream the download — important for large audio files
            # 'stream' means we download in chunks instead of all at once
            async with client.stream("GET", audio_url, follow_redirects=True, timeout=120.0) as response:
                response.raise_for_status()
                with open(tmp_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
    except Exception as e:
        # Clean up on failure
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise RuntimeError(f"Failed to download audio: {e}")

    return tmp_path


def group_words_into_sentences(segments: list[dict]) -> list[dict]:
    """
    Whisper returns words grouped by segments. We regroup them into
    proper sentences by detecting sentence-ending punctuation (. ! ?).

    This gives us natural sentence boundaries for highlighting.
    """
    sentences = []
    current_words = []
    current_text = ""

    for segment in segments:
        # Each segment from Whisper has a list of words with timestamps
        words = segment.get("words", [])
        for w in words:
            word_text = w.get("word", "").strip()
            if not word_text:
                continue

            current_words.append({
                "word": word_text,
                "start": round(w.get("start", 0.0), 2),
                "end": round(w.get("end", 0.0), 2),
            })
            current_text += word_text + " "

            # Check if this word ends a sentence
            if word_text.rstrip().endswith((".", "!", "?", '."', '?"', '!"')):
                sentences.append({
                    "text": current_text.strip(),
                    "start": current_words[0]["start"],
                    "end": current_words[-1]["end"],
                    "words": list(current_words),
                })
                current_words = []
                current_text = ""

    # Don't forget any remaining words that didn't end with punctuation
    if current_words:
        sentences.append({
            "text": current_text.strip(),
            "start": current_words[0]["start"],
            "end": current_words[-1]["end"],
            "words": list(current_words),
        })

    return sentences


async def transcribe(audio_url: str, episode_id: str) -> dict:
    """
    Main transcription function. Downloads audio, runs Whisper,
    and returns timestamped sentences.

    Args:
        audio_url: URL of the audio file (MP3)
        episode_id: Unique ID for caching

    Returns:
        Dict with episode_id and list of timestamped sentences
    """
    # Step 1: Check cache first — avoid re-transcribing!
    cached = load_from_cache(episode_id)
    if cached:
        logger.info("Found cached transcript for %s", episode_id)
        return cached

    logger.info("Transcribing episode %s... (this may take a few minutes)", episode_id)

    # Step 2: Download the audio file
    audio_path = await download_audio(audio_url)

    try:
        # Step 3: Get the Whisper model (loaded once, reused)
        # "base" is a good balance between speed and accuracy
        # Options: tiny, base, small, medium, large
        # Larger = more accurate but slower
        model = get_whisper_model()

        # Step 4: Run transcription with word-level timestamps
        # IMPORTANT: model.transcribe() is CPU-bound and blocks for minutes.
        # We run it in a thread pool so the async event loop stays responsive
        # and other HTTP requests can still be served while we wait.
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: model.transcribe(
            audio_path,
            word_timestamps=True,
            language="en",
        ))

        # Step 5: Group words into sentences
        sentences = group_words_into_sentences(result["segments"])

        # Step 6: Build the final result
        # Use .get() to avoid KeyError if the last segment lacks an "end" key
        last_seg = result["segments"][-1] if result["segments"] else {}
        transcript_data = {
            "episode_id": episode_id,
            "language": result.get("language", "en"),
            "total_duration": round(last_seg.get("end", 0), 2),
            "sentences": sentences,
        }

        # Step 7: Cache the result for next time
        save_to_cache(episode_id, transcript_data)
        logger.info("Transcription complete! %d sentences found.", len(sentences))

        return transcript_data

    finally:
        # Always clean up the downloaded audio file
        if os.path.exists(audio_path):
            os.unlink(audio_path)
