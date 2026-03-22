"""
NPR Podcast Scraper
===================
This module fetches podcast episode metadata from NPR.

We use two approaches:
1. RSS feeds for episode listings (stable, reliable, doesn't break)
2. HTML scraping for individual episode details (audio URL extraction)

KEY CONCEPT: RSS Feeds
- RSS (Really Simple Syndication) is a standard format for publishing content
- Podcasts ALL have RSS feeds — it's how apps like Apple Podcasts discover episodes
- RSS is XML-based, so we parse it with BeautifulSoup's XML parser
- Unlike HTML scraping, RSS feeds are stable and don't change with website redesigns

You'll learn: HTTP requests, XML/RSS parsing, HTML scraping, error handling
"""

import httpx
from bs4 import BeautifulSoup
import re
import logging

# Set up logging — better than print() for server applications
# logging lets you control verbosity levels and output format
logger = logging.getLogger(__name__)

# ─── Podcast Directory ────────────────────────────────────────
# SHOWS is the master list of all NPR podcasts we support.
# Each entry maps a URL-friendly slug to a dict with:
#   - feed_id: NPR's internal podcast ID (used to build the RSS feed URL)
#   - name: Human-readable show name (displayed in the frontend)
#   - category: Grouping category (used for filtering/browsing in the UI)
#
# These were discovered via the iTunes/Apple Podcasts search API:
#   https://itunes.apple.com/search?term=NPR&media=podcast
#
# SECURITY: Only these known shows are allowed — prevents URL manipulation.
# If a user requests a slug not in this dict, we reject it.
SHOWS = {
    "up-first": {"feed_id": "510318", "name": "Up First", "category": "News"},
    "npr-news-now": {"feed_id": "500005", "name": "NPR News Now", "category": "News"},
    "consider-this": {"feed_id": "510355", "name": "Consider This", "category": "News"},
    "morning-edition": {"feed_id": "3", "name": "Morning Edition", "category": "News"},
    "all-things-considered": {"feed_id": "2", "name": "All Things Considered", "category": "News"},
    "weekend-edition-saturday": {"feed_id": "7", "name": "Weekend Edition Saturday", "category": "News"},
    "weekend-edition-sunday": {"feed_id": "10", "name": "Weekend Edition Sunday", "category": "News"},
    "state-of-the-world": {"feed_id": "510366", "name": "State of the World", "category": "News"},
    "here-and-now": {"feed_id": "510051", "name": "Here & Now Anytime", "category": "News"},
    "1a": {"feed_id": "510316", "name": "1A", "category": "News"},
    "politics-podcast": {"feed_id": "510310", "name": "The NPR Politics Podcast", "category": "Politics"},
    "trumps-terms": {"feed_id": "510374", "name": "Trump's Terms", "category": "Politics"},
    "sources-and-methods": {"feed_id": "g-s1-84651", "name": "Sources & Methods", "category": "Politics"},
    "extremely-american": {"feed_id": "510381", "name": "Extremely American", "category": "Politics"},
    "no-compromise": {"feed_id": "510356", "name": "No Compromise", "category": "Politics"},
    "landslide": {"feed_id": "510376", "name": "Landslide", "category": "History"},
    "fresh-air": {"feed_id": "381444908", "name": "Fresh Air", "category": "Culture"},
    "pop-culture-happy-hour": {"feed_id": "510282", "name": "Pop Culture Happy Hour", "category": "Culture"},
    "its-been-a-minute": {"feed_id": "510317", "name": "It's Been a Minute", "category": "Culture"},
    "bullseye": {"feed_id": "510309", "name": "Bullseye with Jesse Thorn", "category": "Culture"},
    "wild-card": {"feed_id": "510379", "name": "Wild Card with Rachel Martin", "category": "Culture"},
    "code-switch": {"feed_id": "510312", "name": "Code Switch", "category": "Culture"},
    "planet-money": {"feed_id": "510289", "name": "Planet Money", "category": "Business"},
    "the-indicator": {"feed_id": "510325", "name": "The Indicator from Planet Money", "category": "Business"},
    "life-kit": {"feed_id": "510338", "name": "Life Kit", "category": "Self-Improvement"},
    "life-kit-health": {"feed_id": "510340", "name": "Life Kit: Health", "category": "Health"},
    "life-kit-money": {"feed_id": "510341", "name": "Life Kit: Money", "category": "Business"},
    "life-kit-parenting": {"feed_id": "510334", "name": "Life Kit: Parenting", "category": "Family"},
    "body-electric": {"feed_id": "510375", "name": "Body Electric", "category": "Health"},
    "ted-radio-hour": {"feed_id": "510298", "name": "TED Radio Hour", "category": "Technology"},
    "hidden-brain": {"feed_id": "510308", "name": "Hidden Brain", "category": "Science"},
    "short-wave": {"feed_id": "510351", "name": "Short Wave", "category": "Science"},
    "how-wild": {"feed_id": "510383", "name": "How Wild", "category": "Science"},
    "bright-lit-place": {"feed_id": "510373", "name": "Bright Lit Place", "category": "Science"},
    "throughline": {"feed_id": "510333", "name": "Throughline", "category": "History"},
    "road-to-rickwood": {"feed_id": "510382", "name": "Road to Rickwood", "category": "History"},
    "invisibilia": {"feed_id": "510307", "name": "Invisibilia", "category": "Society"},
    "embedded": {"feed_id": "510311", "name": "Embedded", "category": "Society"},
    "storycorps": {"feed_id": "510200", "name": "StoryCorps", "category": "Society"},
    "black-stories-black-truths": {"feed_id": "510372", "name": "Black Stories. Black Truths.", "category": "Society"},
    "louder-than-a-riot": {"feed_id": "510357", "name": "Louder Than A Riot", "category": "Society"},
    "taking-cover": {"feed_id": "510368", "name": "Taking Cover", "category": "Society"},
    "believed": {"feed_id": "510326", "name": "Believed", "category": "Society"},
    "inheriting": {"feed_id": "510380", "name": "Inheriting", "category": "Society"},
    "track-change": {"feed_id": "510378", "name": "Track Change", "category": "Society"},
    "rough-translation": {"feed_id": "510324", "name": "Rough Translation", "category": "Society"},
    "white-lies": {"feed_id": "510343", "name": "White Lies", "category": "True Crime"},
    "wait-wait-dont-tell-me": {"feed_id": "344098539", "name": "Wait Wait... Don't Tell Me!", "category": "Comedy"},
    "how-to-do-everything": {"feed_id": "510384", "name": "How To Do Everything", "category": "Comedy"},
    "ask-me-another": {"feed_id": "510299", "name": "Ask Me Another", "category": "Comedy"},
    "car-talk": {"feed_id": "510208", "name": "The Best of Car Talk", "category": "Comedy"},
    "tiny-desk-concerts": {"feed_id": "510306", "name": "Tiny Desk Concerts - Audio", "category": "Music"},
    "all-songs-considered": {"feed_id": "g-s1-111189", "name": "All Songs Considered", "category": "Music"},
    "npr-music": {"feed_id": "510019", "name": "NPR Music", "category": "Music"},
    "book-of-the-day": {"feed_id": "510364", "name": "NPR's Book of the Day", "category": "Books"},
    "students-podcast": {"feed_id": "510354", "name": "The Students' Podcast", "category": "Education"},
}

# Backward-compatible lookup: slug → feed_id
# Existing code (like get_episodes) uses SHOW_IDS to find the RSS feed.
# We derive it from the master SHOWS dict so there's a single source of truth.
SHOW_IDS = {slug: info["feed_id"] for slug, info in SHOWS.items()}


def get_show_list():
    """
    Return the list of available shows for the frontend API.

    This builds a simple list of dicts with just the fields the frontend
    needs to display the podcast browser (slug, name, category).
    We don't include feed_id — that's an internal implementation detail.
    """
    return [
        {"slug": slug, "name": info["name"], "category": info["category"]}
        for slug, info in SHOWS.items()
    ]


async def get_episodes(show_name: str = "up-first", limit: int = 20) -> list[dict]:
    """
    Fetch recent episodes for a given NPR show using RSS feeds.

    RSS feeds are much more reliable than HTML scraping because:
    - They follow a standard format (XML)
    - They don't change when the website is redesigned
    - They contain all the data we need (title, date, audio URL)

    Args:
        show_name: NPR show slug (e.g., "up-first", "morning-edition")
        limit: Maximum number of episodes to return

    Returns:
        List of dicts with keys: title, date, url, audio_url
    """
    # SECURITY: Reject unknown show names instead of silently falling back
    # This prevents URL path manipulation attacks
    if show_name not in SHOW_IDS:
        logger.warning("Unknown show requested: %s", show_name)
        return []

    show_id = SHOW_IDS[show_name]

    # NPR provides RSS feeds for all podcasts at this URL pattern
    rss_url = f"https://feeds.npr.org/{show_id}/podcast.xml"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(rss_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
            }, follow_redirects=True, timeout=15.0)
            response.raise_for_status()
    except httpx.HTTPError as e:
        logger.error("Error fetching RSS feed for %s: %s", show_name, e)
        return []

    # Parse the RSS XML with BeautifulSoup
    # 'xml' parser is used for XML documents (RSS is XML)
    # 'html.parser' is for HTML — don't mix them up!
    soup = BeautifulSoup(response.text, "xml")

    episodes = []

    # In RSS, each episode is an <item> element containing:
    # - <title> — episode title
    # - <pubDate> — publication date
    # - <link> — web page URL
    # - <enclosure> — the audio file (with url, type, length attributes)
    items = soup.find_all("item")

    for item in items[:limit]:
        title = item.find("title")
        pub_date = item.find("pubDate")
        link = item.find("link")
        enclosure = item.find("enclosure")

        # Extract audio URL from the <enclosure> tag
        # The 'url' attribute contains the direct link to the MP3 file
        audio_url = ""
        if enclosure and enclosure.get("url"):
            audio_url = enclosure["url"]

        # Build the episode URL — prefer <link>, fall back to constructing one
        episode_url = ""
        if link and link.string:
            episode_url = link.string.strip()
        elif link and link.get("href"):
            episode_url = link["href"]

        episodes.append({
            "title": title.string.strip() if title and title.string else "Untitled",
            "date": pub_date.string.strip() if pub_date and pub_date.string else "",
            "url": episode_url,
            "audio_url": audio_url,
        })

    logger.info("Found %d episodes for %s", len(episodes), show_name)
    return episodes


async def get_episode_details(episode_url: str) -> dict:
    """
    Fetch details for a specific episode, including the audio URL.

    We look for the audio URL in multiple places (fallback strategy):
    1. Open Graph meta tags (og:audio) — most reliable
    2. <audio> HTML element
    3. MP3 URLs in embedded JavaScript
    4. Download links

    This is HTML scraping — less reliable than RSS but necessary
    for getting audio URLs from individual episode pages.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(episode_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
            }, follow_redirects=True, timeout=15.0)
            response.raise_for_status()
    except httpx.HTTPError as e:
        logger.error("Error fetching episode page: %s", e)
        return {}

    soup = BeautifulSoup(response.text, "html.parser")

    # Strategy 1: Look for Open Graph audio meta tag
    # og:audio is a standard way websites declare their audio content
    og_audio = soup.find("meta", property="og:audio")
    audio_url = og_audio["content"] if og_audio and og_audio.get("content") else ""

    # Strategy 2: Look for <audio> HTML element
    if not audio_url:
        audio_tag = soup.find("audio")
        if audio_tag:
            source = audio_tag.find("source")
            audio_url = source["src"] if source and source.get("src") else ""

    # Strategy 3: Search for MP3 URLs in script tags
    # Sometimes audio URLs are embedded in JavaScript data
    if not audio_url:
        for script in soup.find_all("script"):
            text = script.string or ""
            mp3_match = re.search(r'https?://[^\s"\']+\.mp3[^\s"\']*', text)
            if mp3_match:
                audio_url = mp3_match.group(0)
                break

    # Strategy 4: Look for download links
    if not audio_url:
        download_link = soup.find("a", href=re.compile(r"\.mp3"))
        if download_link:
            audio_url = download_link["href"]

    # Extract title and date from meta tags
    title_tag = soup.find("meta", property="og:title")
    title = title_tag["content"] if title_tag else ""
    if not title and soup.title:
        title = soup.title.string or ""

    date_tag = soup.find("meta", property="article:published_time")
    date = date_tag["content"] if date_tag else ""

    # Extract episode ID from URL for caching
    episode_id = _extract_episode_id(episode_url)

    return {
        "title": title.strip() if title else "",
        "date": date,
        "url": episode_url,
        "audio_url": audio_url,
        "episode_id": episode_id,
    }


def _extract_episode_id(url: str) -> str:
    """
    Extract a unique ID from an NPR URL.
    NPR URLs often contain numeric IDs like: /2024/01/15/1234567890/story-title
    """
    match = re.search(r'/(\d{8,})', url)
    if match:
        return match.group(1)
    # Fallback: use the last path segment
    parts = url.rstrip("/").split("/")
    return parts[-1] if parts else "unknown"
