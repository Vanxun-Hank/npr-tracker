"""
FastAPI Backend Server
======================
This is the main server that ties everything together.
It provides a REST API for the frontend to fetch episodes and transcripts.

You'll learn: REST APIs, async Python, HTTP methods, serving static files.

Run with: python main.py
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
import httpx
import os
from urllib.parse import urlparse

# SECURITY: Only allow audio proxying from known NPR domains
# This prevents SSRF (Server-Side Request Forgery) attacks where
# someone could use our proxy to access internal servers
ALLOWED_AUDIO_HOSTS = {
    "media.npr.org",
    "ondemand.npr.org",
    "play.podtrac.com",
    "pd.npr.org",
    "npr.org",
    "npr.simplecastaudio.com",   # RSS feed audio host
    "prfx.byspotify.com",       # Spotify podcast proxy
    "tracking.swap.fm",          # WAMU/NPR show audio tracker
    "dcs.megaphone.fm",          # Megaphone CDN (some NPR shows)
    "traffic.megaphone.fm",      # Megaphone traffic redirect
}

# Import our own modules
from scraper import get_episodes, get_episode_details, get_show_list
from transcriber import transcribe

# Create the FastAPI app — this is the core of our server
app = FastAPI(
    title="NPR Transcript Tracker",
    description="A tool to track your position in NPR podcast transcripts",
)

# CORS (Cross-Origin Resource Sharing) middleware
# This allows our frontend to make requests to the backend
# In production, you'd restrict this to your domain only
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # Allow all origins (for development)
    allow_methods=["*"],       # Allow all HTTP methods
    allow_headers=["*"],       # Allow all headers
)


# ─── API Endpoints ────────────────────────────────────────────


@app.get("/api/shows")
async def api_shows():
    """
    GET /api/shows

    Returns the full list of available NPR podcasts.
    The frontend uses this to populate the podcast browser.
    This is a static list — no network calls needed, so it's instant.

    Each item has: slug (URL-safe ID), name (display name), category (for grouping).
    """
    # get_show_list() returns a list of dicts from the SHOWS master dictionary
    # in scraper.py — no database or network calls involved
    return get_show_list()


@app.get("/api/episodes")
async def api_episodes(
    show: str = Query(default="up-first", description="NPR show slug"),
    limit: int = Query(default=20, ge=1, le=300, description="Max episodes to return"),
):
    """
    GET /api/episodes?show=up-first&limit=20

    Returns a list of recent episodes for the given show.
    The frontend calls this to populate the episode list.

    The 'limit' parameter controls how many episodes to fetch.
    Default is 20 for browsing; the search feature uses
    limit=100 to search through more episodes.
    """
    episodes = await get_episodes(show, limit=limit)
    if not episodes:
        # Return empty list instead of error — the frontend can handle this
        return []
    return episodes


@app.get("/api/transcript")
async def api_transcript(
    url: str = Query(description="NPR episode URL"),
    audio_url: str = Query(default="", description="Direct audio URL (optional, skips scraping)"),
):
    """
    GET /api/transcript?url=https://...&audio_url=https://...mp3

    Returns a timestamped transcript for the episode.
    If audio_url is provided (from the RSS feed), we skip scraping.
    Otherwise, we scrape the episode page for the audio URL.
    This may take several minutes on first request (while Whisper processes).
    """
    episode_audio_url = audio_url
    episode_title = ""
    episode_id = ""

    if episode_audio_url:
        # Audio URL provided directly (from RSS feed) — no scraping needed!
        from scraper import _extract_episode_id
        episode_id = _extract_episode_id(url)
    else:
        # Fallback: scrape the episode page to find the audio URL
        details = await get_episode_details(url)
        if not details or not details.get("audio_url"):
            raise HTTPException(
                status_code=404,
                detail="Could not find audio URL for this episode. "
                       "The episode page might not contain an audio player."
            )
        episode_audio_url = details["audio_url"]
        episode_title = details.get("title", "")
        episode_id = details.get("episode_id", "unknown")

    # Transcribe the audio
    try:
        result = await transcribe(
            audio_url=episode_audio_url,
            episode_id=episode_id,
        )
        # Include episode metadata in the response
        result["title"] = episode_title
        result["audio_url"] = episode_audio_url
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()  # Print full traceback to server logs
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(e)}"
        )


@app.get("/api/audio-proxy")
async def api_audio_proxy(url: str = Query(description="Audio file URL to proxy")):
    """
    GET /api/audio-proxy?url=https://...mp3

    Proxies an audio stream from NPR's servers.

    Why do we need this? Because of CORS — browsers block requests
    to different domains for security. By proxying through our server,
    the browser thinks the audio comes from the same origin.
    """
    # SECURITY: Validate the URL before proxying
    # Without this check, an attacker could use our server to access
    # internal services (like cloud metadata APIs) — this is called SSRF
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only HTTP/HTTPS URLs allowed")
    if parsed.hostname and not any(
        parsed.hostname == host or parsed.hostname.endswith("." + host)
        for host in ALLOWED_AUDIO_HOSTS
    ):
        raise HTTPException(status_code=400, detail="URL domain not allowed — only NPR audio hosts are permitted")

    # NPR audio URLs go through multiple redirects:
    #   prfx.byspotify.com → play.podtrac.com → npr.simplecastaudio.com
    # We follow redirects manually with streaming to avoid buffering the
    # entire file in memory. Each redirect is closed before following the next.
    # proxy=None bypasses any system HTTP proxy (e.g. Clash) which can
    # interfere with streaming large audio files through redirect chains.
    client = httpx.AsyncClient(timeout=120.0, proxy=None)
    try:
        current_url = url
        for _ in range(10):  # Max 10 redirects to prevent infinite loops
            req = client.build_request("GET", current_url, headers={"User-Agent": "Mozilla/5.0"})
            upstream = await client.send(req, stream=True, follow_redirects=False)
            if upstream.status_code in (301, 302, 303, 307, 308):
                redirect_url = upstream.headers.get("location", "")
                await upstream.aclose()
                if not redirect_url:
                    break
                current_url = redirect_url
            else:
                break  # Got the actual audio response
    except Exception as e:
        await client.aclose()  # Clean up on failure — prevents connection leak
        raise HTTPException(status_code=502, detail=f"Failed to fetch audio: {e}")

    # Get the actual content type and length from the upstream server
    content_type = upstream.headers.get("content-type", "audio/mpeg")
    content_length = upstream.headers.get("content-length")

    async def stream_audio():
        """Generator that streams audio data chunk by chunk."""
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=8192):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    # StreamingResponse sends data to the browser as it arrives
    # instead of waiting for the entire file to download
    # Content-Length is critical — without it, browsers can't determine
    # the audio duration or enable seeking within the track
    response_headers = {
        "Cache-Control": "public, max-age=86400",  # Cache for 1 day
    }
    if content_length:
        response_headers["Content-Length"] = content_length

    return StreamingResponse(
        stream_audio(),
        media_type=content_type,
        headers=response_headers,
    )


# ─── Serve Frontend Static Files ──────────────────────────────

# Mount the frontend directory to serve HTML, CSS, JS files
# This must be LAST — it's a catch-all that serves any file
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    # Warn loudly if the frontend directory is missing — this is a common
    # mistake when running from the wrong directory
    import logging
    logging.getLogger(__name__).warning(
        "Frontend directory not found at %s — static files will NOT be served. "
        "Make sure you run the server from the project root.", frontend_dir
    )


# ─── Run the Server ───────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  NPR Transcript Tracker")
    print("  Open http://localhost:8000 in your browser")
    print("=" * 50)
    # host="0.0.0.0" makes the server accessible from other devices
    # on the same network (like your phone!)
    uvicorn.run(app, host="0.0.0.0", port=8000)
