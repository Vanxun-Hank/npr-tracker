/**
 * App Module — Main Application Logic
 * ======================================
 * This is the "conductor" that coordinates all other modules.
 * It handles navigation between views and connects user actions
 * to the right module functions.
 *
 * KEY CONCEPT: Single Page Application (SPA)
 * - Traditional websites load a new HTML page for each view
 * - An SPA loads ONE page and shows/hides different sections with JavaScript
 * - This feels faster because there's no full page reload
 * - We toggle CSS classes to show/hide views
 *
 * KEY CONCEPT: Fetch API
 * - fetch() is the modern way to make HTTP requests from JavaScript
 * - It returns a Promise — an object representing a future result
 * - We use .then() to handle the result when it arrives
 * - Or async/await syntax for cleaner code
 *
 * You'll learn: SPA navigation, fetch API, async/await, module coordination
 */

window.NPR = window.NPR || {};

(function () {
    // ─── State ────────────────────────────────────────────
    var currentEpisodeUrl = '';   // URL of the currently loaded episode
    var currentView = 'view-episodes';  // Which view is currently showing
    var allShows = [];               // Full show list from API
    var selectedShowSlug = '';       // Currently selected show slug
    var isPickerExpanded = false;    // Whether the show picker is open
    var currentEpisodes = [];        // Episodes for the currently selected show
    var hasLoadedAllEpisodes = false; // Whether we've fetched the full episode list

    /**
     * Initialize the app — called when the page finishes loading.
     *
     * DOMContentLoaded fires when the HTML is fully parsed.
     * This is the right time to set up our app because all
     * elements exist in the DOM.
     */
    document.addEventListener('DOMContentLoaded', function () {
        // Initialize all modules
        window.NPR.Player.init();
        window.NPR.Transcript.init();
        window.NPR.Vocab.init();

        // Set up navigation
        setupNavigation();

        // Set up episode loading and search
        setupShowPicker();
        setupEpisodeSearch();
        setupBackButton();

        // Fetch show list and load last-selected show (or Up First)
        fetchShows();
    });

    /**
     * Set up the bottom navigation bar.
     * Each nav button has a data-view attribute telling us which view to show.
     */
    function setupNavigation() {
        var navButtons = document.querySelectorAll('.nav-btn');

        navButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var viewId = btn.getAttribute('data-view');
                switchView(viewId);

                // Update active state on nav buttons
                navButtons.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');

                // Re-render vocab list when switching to vocab view
                if (viewId === 'view-vocab') {
                    window.NPR.Vocab.renderVocabList();
                }
            });
        });
    }

    /**
     * Switch to a different view (Episodes, Player, or Vocab).
     *
     * We hide all views first, then show the requested one.
     * This is the core SPA navigation mechanism.
     */
    function switchView(viewId) {
        // Hide all views
        var views = document.querySelectorAll('.view');
        views.forEach(function (v) { v.classList.remove('active'); });

        // Show the requested view
        var target = document.getElementById(viewId);
        if (target) {
            target.classList.add('active');
        }
        currentView = viewId;
    }

    /**
     * Fetch the full list of NPR podcasts from the backend.
     * Called once on page load — the list is stored in memory
     * for instant client-side filtering.
     */
    function fetchShows() {
        fetch('/api/shows')
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP error: ' + response.status);
                return response.json();
            })
            .then(function (shows) {
                allShows = shows;
                // Try to restore last selected show from localStorage
                var savedShow = null;
                try { savedShow = localStorage.getItem('npr-selected-show'); } catch (e) {}
                if (savedShow && allShows.some(function(s) { return s.slug === savedShow; })) {
                    selectedShowSlug = savedShow;
                    var show = allShows.find(function(s) { return s.slug === savedShow; });
                    document.getElementById('selected-show-name').textContent = show.name;
                    loadEpisodes(savedShow);
                } else {
                    selectedShowSlug = 'up-first';
                    loadEpisodes('up-first');
                }
            })
            .catch(function (error) {
                console.error('Failed to fetch shows:', error);
                // Fallback: load Up First directly
                selectedShowSlug = 'up-first';
                loadEpisodes('up-first');
            });
    }

    /**
     * Set up the show picker — search, browse, and select podcasts.
     *
     * UI FLOW:
     * 1. User sees selected show name with "Change" button
     * 2. Tap "Change" → search box + full show list appears
     * 3. Type to filter → list updates instantly
     * 4. Tap a show card → selects it, loads episodes, collapses picker
     */
    function setupShowPicker() {
        var selectedShowEl = document.getElementById('selected-show');
        var searchInput = document.getElementById('show-search');
        var showListEl = document.getElementById('show-list');
        var episodeList = document.getElementById('episode-list');

        // Tap "Change" to toggle the show picker
        // We use a boolean state variable instead of inspecting DOM styles
        selectedShowEl.addEventListener('click', function () {
            if (isPickerExpanded) {
                collapseShowPicker();
            } else {
                expandShowPicker();
            }
        });

        // Search input — filter shows as the user types
        searchInput.addEventListener('input', function () {
            var query = searchInput.value.toLowerCase().trim();
            renderShowList(query);
        });
    }

    /**
     * Expand the show picker — show search input and full show list.
     */
    function expandShowPicker() {
        var searchInput = document.getElementById('show-search');
        var showListEl = document.getElementById('show-list');
        var episodeList = document.getElementById('episode-list');

        isPickerExpanded = true;
        document.getElementById('selected-show').setAttribute('aria-expanded', 'true');
        searchInput.style.display = 'block';
        showListEl.style.display = 'flex';
        episodeList.style.display = 'none';
        document.getElementById('episode-search').style.display = 'none';
        searchInput.value = '';
        searchInput.focus();
        renderShowList('');
    }

    /**
     * Collapse the show picker — hide search and show list, show episodes.
     */
    function collapseShowPicker() {
        var searchInput = document.getElementById('show-search');
        var showListEl = document.getElementById('show-list');
        var episodeList = document.getElementById('episode-list');

        isPickerExpanded = false;
        document.getElementById('selected-show').setAttribute('aria-expanded', 'false');
        searchInput.style.display = 'none';
        searchInput.value = '';
        showListEl.style.display = 'none';
        // Reset to empty string so the CSS stylesheet rule takes over
        // (don't hardcode 'flex' — let .episode-list's CSS handle it)
        episodeList.style.display = '';
        document.getElementById('episode-search').style.display = '';
    }

    /**
     * Render the show list, optionally filtered by a search query.
     * Shows are grouped by category with sticky headers.
     *
     * KEY CONCEPT: Client-side filtering
     * Instead of making an API call for each search, we filter
     * the in-memory list. This is instant and works offline.
     */
    function renderShowList(query) {
        var showListEl = document.getElementById('show-list');

        // Clear existing content
        while (showListEl.firstChild) {
            showListEl.removeChild(showListEl.firstChild);
        }

        // Filter shows by query (match against name)
        var filtered = allShows;
        if (query) {
            filtered = allShows.filter(function (show) {
                return show.name.toLowerCase().indexOf(query) !== -1;
            });
        }

        if (filtered.length === 0) {
            var emptyMsg = document.createElement('p');
            emptyMsg.className = 'empty-state';
            emptyMsg.textContent = 'No podcasts found for "' + query + '"';
            showListEl.appendChild(emptyMsg);
            return;
        }

        // Group shows by category
        // KEY CONCEPT: reduce() builds an object from an array
        var grouped = {};
        filtered.forEach(function (show) {
            if (!grouped[show.category]) {
                grouped[show.category] = [];
            }
            grouped[show.category].push(show);
        });

        // Render each category group
        // Object.keys() gets all category names
        Object.keys(grouped).forEach(function (category) {
            // Category header
            var header = document.createElement('div');
            header.className = 'show-category-header';
            header.textContent = category;
            showListEl.appendChild(header);

            // Show cards within this category
            grouped[category].forEach(function (show) {
                var card = document.createElement('div');
                card.className = 'show-card';

                var nameEl = document.createElement('span');
                nameEl.className = 'show-card-name';
                nameEl.textContent = show.name;
                card.appendChild(nameEl);

                var categoryEl = document.createElement('span');
                categoryEl.className = 'show-card-category';
                categoryEl.setAttribute('data-category', show.category);
                categoryEl.textContent = show.category;
                card.appendChild(categoryEl);

                // Make card keyboard-accessible
                card.setAttribute('tabindex', '0');
                card.setAttribute('role', 'option');

                // Click or keyboard to select this show
                card.addEventListener('click', function () {
                    selectShow(show);
                });
                card.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectShow(show);
                    }
                });

                showListEl.appendChild(card);
            });
        });
    }

    /**
     * Select a show — update the display, load episodes, save preference.
     */
    function selectShow(show) {
        selectedShowSlug = show.slug;

        // Update the selected show display
        document.getElementById('selected-show-name').textContent = show.name;

        // Collapse the picker and show episodes
        collapseShowPicker();

        // Load episodes for this show
        loadEpisodes(show.slug);

        // Save the selection to localStorage
        // try/catch because localStorage can fail in private browsing mode
        try { localStorage.setItem('npr-selected-show', show.slug); } catch (e) {}
    }

    /**
     * Set up episode title search — filter episodes as the user types.
     *
     * KEY CONCEPT: Debounced search with lazy loading
     * - On first keystroke, we fetch more episodes (limit=100) from the API
     *   so the user can search through a larger list, not just the 10 shown
     * - Subsequent keystrokes filter the in-memory list instantly
     * - This avoids hammering the API on every keystroke
     */
    function setupEpisodeSearch() {
        var episodeSearch = document.getElementById('episode-search');

        episodeSearch.addEventListener('input', function () {
            var query = episodeSearch.value.toLowerCase().trim();

            if (!query) {
                // Empty search — show all episodes
                renderEpisodeList(currentEpisodes);
                return;
            }

            // On first search, load more episodes from the API
            // so we have a bigger list to search through
            if (!hasLoadedAllEpisodes && selectedShowSlug) {
                hasLoadedAllEpisodes = true;
                fetch('/api/episodes?show=' + encodeURIComponent(selectedShowSlug) + '&limit=100')
                    .then(function (response) {
                        if (!response.ok) throw new Error('HTTP error: ' + response.status);
                        return response.json();
                    })
                    .then(function (episodes) {
                        currentEpisodes = episodes;
                        // Re-filter with current query (user may have typed more)
                        var currentQuery = episodeSearch.value.toLowerCase().trim();
                        if (currentQuery) {
                            var filtered = currentEpisodes.filter(function (ep) {
                                return ep.title.toLowerCase().indexOf(currentQuery) !== -1;
                            });
                            renderEpisodeList(filtered);
                        }
                    })
                    .catch(function (error) {
                        console.error('Failed to load more episodes:', error);
                    });
            }

            // Filter the in-memory episode list by title
            var filtered = currentEpisodes.filter(function (ep) {
                return ep.title.toLowerCase().indexOf(query) !== -1;
            });
            renderEpisodeList(filtered);
        });
    }

    /**
     * Set up the back button in the player view.
     */
    function setupBackButton() {
        var btnBack = document.getElementById('btn-back');
        btnBack.addEventListener('click', function () {
            // Save current position before leaving
            if (currentEpisodeUrl) {
                var currentTime = window.NPR.Player.getCurrentTime();
                window.NPR.Bookmark.saveBookmark(currentEpisodeUrl, currentTime);
                window.NPR.Bookmark.stopAutoSave();
            }
            switchView('view-episodes');

            // Update nav button states — use data-view selector for robustness
            var navButtons = document.querySelectorAll('.nav-btn');
            navButtons.forEach(function (b) { b.classList.remove('active'); });
            var episodesBtn = document.querySelector('[data-view="view-episodes"]');
            if (episodesBtn) episodesBtn.classList.add('active');
        });
    }

    /**
     * Fetch and display episodes for a given show.
     *
     * KEY CONCEPT: fetch() and Promises
     * - fetch(url) sends an HTTP request and returns a Promise
     * - .then(response => response.json()) parses the JSON body
     * - .then(data => ...) handles the parsed data
     * - .catch(error => ...) handles any errors
     */
    function loadEpisodes(showName) {
        var episodeList = document.getElementById('episode-list');
        var episodeSearch = document.getElementById('episode-search');

        // Clear search when loading a new show
        episodeSearch.value = '';
        hasLoadedAllEpisodes = false;

        // Show loading state
        while (episodeList.firstChild) {
            episodeList.removeChild(episodeList.firstChild);
        }
        var loadingMsg = document.createElement('p');
        loadingMsg.className = 'loading';
        loadingMsg.textContent = 'Loading episodes...';
        episodeList.appendChild(loadingMsg);

        // Fetch episodes from our backend API
        fetch('/api/episodes?show=' + encodeURIComponent(showName))
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP error: ' + response.status);
                }
                return response.json();  // Parse JSON response
            })
            .then(function (episodes) {
                // Store episodes in memory for client-side search filtering
                currentEpisodes = episodes;
                renderEpisodeList(episodes);
            })
            .catch(function (error) {
                console.error('Failed to load episodes:', error);
                while (episodeList.firstChild) {
                    episodeList.removeChild(episodeList.firstChild);
                }
                var errorMsg = document.createElement('p');
                errorMsg.className = 'error-msg';
                errorMsg.textContent = 'Failed to load episodes. Is the server running?';
                episodeList.appendChild(errorMsg);
            });
    }

    /**
     * Render the episode list as clickable cards.
     */
    function renderEpisodeList(episodes) {
        var episodeList = document.getElementById('episode-list');

        // Clear existing content safely
        while (episodeList.firstChild) {
            episodeList.removeChild(episodeList.firstChild);
        }

        if (episodes.length === 0) {
            var emptyMsg = document.createElement('p');
            emptyMsg.className = 'empty-state';
            emptyMsg.textContent = 'No episodes found for this show.';
            episodeList.appendChild(emptyMsg);
            return;
        }

        episodes.forEach(function (episode) {
            var card = document.createElement('div');
            card.className = 'episode-card';

            var titleEl = document.createElement('div');
            titleEl.className = 'episode-card-title';
            titleEl.textContent = episode.title;
            card.appendChild(titleEl);

            if (episode.date) {
                var dateEl = document.createElement('div');
                dateEl.className = 'episode-card-date';
                dateEl.textContent = episode.date;
                card.appendChild(dateEl);
            }

            // Check if there's a bookmark for this episode
            var bookmark = window.NPR.Bookmark.getBookmark(episode.url);
            if (bookmark) {
                var resumeEl = document.createElement('div');
                resumeEl.className = 'episode-card-date';
                resumeEl.textContent = 'Has bookmark';
                resumeEl.style.color = '#e94560';
                card.appendChild(resumeEl);
            }

            // Click to load this episode
            card.addEventListener('click', function () {
                loadEpisode(episode);
            });

            episodeList.appendChild(card);
        });
    }

    /**
     * Load a specific episode — fetch transcript and set up player.
     * This is where everything comes together!
     */
    function loadEpisode(episode) {
        currentEpisodeUrl = episode.url;

        // Switch to player view
        switchView('view-player');

        // Set episode title
        var titleEl = document.getElementById('episode-title');
        titleEl.textContent = episode.title || 'Loading...';

        // Load audio immediately via proxy (don't wait for transcript)
        if (episode.audio_url) {
            window.NPR.Player.loadTrack('/api/audio-proxy?url=' + encodeURIComponent(episode.audio_url));
        }

        // Tell vocab module which episode we're on
        window.NPR.Vocab.setEpisodeName(episode.title);

        // Show loading state in transcript
        var transcriptContainer = document.getElementById('transcript-container');
        while (transcriptContainer.firstChild) {
            transcriptContainer.removeChild(transcriptContainer.firstChild);
        }
        var loadingMsg = document.createElement('p');
        loadingMsg.className = 'loading';
        loadingMsg.textContent = 'Loading transcript... (first load may take a few minutes while AI processes the audio)';
        transcriptContainer.appendChild(loadingMsg);

        // Hide resume prompt initially
        document.getElementById('resume-prompt').style.display = 'none';

        // Fetch the transcript from our backend
        // If the episode already has an audio_url (from RSS), pass it directly
        // to skip unnecessary scraping of the episode page
        var transcriptUrl = '/api/transcript?url=' + encodeURIComponent(episode.url);
        if (episode.audio_url) {
            transcriptUrl += '&audio_url=' + encodeURIComponent(episode.audio_url);
        }
        // Capture the expected URL so we can detect stale responses
        // If the user clicks a different episode while this is loading,
        // currentEpisodeUrl will change, and we discard this stale response
        var expectedUrl = episode.url;
        fetch(transcriptUrl)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP error: ' + response.status);
                }
                return response.json();
            })
            .then(function (data) {
                // Discard stale response if user switched to a different episode
                if (currentEpisodeUrl !== expectedUrl) return;

                // Update title if the API returned one
                if (data.title) {
                    titleEl.textContent = data.title;
                }

                // Load transcript into the view
                window.NPR.Transcript.loadTranscript(data);

                // Load audio via proxy if not already loaded
                if (data.audio_url && !episode.audio_url) {
                    window.NPR.Player.loadTrack('/api/audio-proxy?url=' + encodeURIComponent(data.audio_url));
                }

                // Check for existing bookmark
                var bookmark = window.NPR.Bookmark.getBookmark(episode.url);
                if (bookmark && bookmark.timestamp > 10) {
                    // Show resume prompt
                    var resumePrompt = document.getElementById('resume-prompt');
                    var resumeTimeEl = document.getElementById('resume-time');
                    resumeTimeEl.textContent = formatTime(bookmark.timestamp);
                    resumePrompt.style.display = 'flex';

                    // Resume button
                    document.getElementById('btn-resume').onclick = function () {
                        window.NPR.Player.seekTo(bookmark.timestamp);
                        resumePrompt.style.display = 'none';
                    };

                    // Start over button
                    document.getElementById('btn-start-over').onclick = function () {
                        resumePrompt.style.display = 'none';
                    };
                }

                // Start auto-saving bookmark position
                window.NPR.Bookmark.startAutoSave(
                    episode.url,
                    window.NPR.Player.getCurrentTime
                );
            })
            .catch(function (error) {
                console.error('Failed to load transcript:', error);
                while (transcriptContainer.firstChild) {
                    transcriptContainer.removeChild(transcriptContainer.firstChild);
                }
                var errorMsg = document.createElement('p');
                errorMsg.className = 'error-msg';
                errorMsg.textContent = 'Failed to load transcript: ' + error.message;
                transcriptContainer.appendChild(errorMsg);
            });
    }

    /**
     * Format seconds into MM:SS string.
     * Duplicated from player.js for convenience.
     */
    function formatTime(seconds) {
        var mins = Math.floor(seconds / 60);
        var secs = Math.floor(seconds % 60);
        return mins + ':' + secs.toString().padStart(2, '0');
    }
})();
