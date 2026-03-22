/**
 * Audio Player Module
 * ====================
 * Controls the HTML5 <audio> element for podcast playback.
 *
 * KEY CONCEPT: HTML5 Audio API
 * - The browser has a built-in audio player accessed via new Audio()
 * - Key properties: .currentTime, .duration, .paused, .playbackRate
 * - Key methods: .play(), .pause(), .load()
 * - Key events: 'timeupdate' (fires ~4x/sec), 'loadedmetadata', 'ended'
 *
 * KEY CONCEPT: Custom Events
 * - We dispatch our own 'npr-timeupdate' event on the document
 * - Other modules (transcript.js) listen for this event
 * - This is how modules communicate without knowing about each other
 *   (called "loose coupling" — a key software design principle)
 *
 * You'll learn: Audio API, DOM events, custom events, time formatting
 */

window.NPR = window.NPR || {};

window.NPR.Player = (function () {
    // ─── DOM Element References ────────────────────────────
    // We get references to HTML elements by their ID
    // document.getElementById() is the most common way to find elements

    let audio = null;  // The Audio object (created when loading a track)

    // These will be set during init()
    let btnPlay = null;
    let seekBar = null;
    let timeCurrent = null;
    let timeDuration = null;
    let speedSelect = null;

    // Track whether user is dragging the seek bar
    let isSeeking = false;

    /**
     * Initialize the player — connect to DOM elements and set up events.
     * This is called once when the app starts.
     */
    function init() {
        btnPlay = document.getElementById('btn-play');
        seekBar = document.getElementById('seek-bar');
        timeCurrent = document.getElementById('time-current');
        timeDuration = document.getElementById('time-duration');
        speedSelect = document.getElementById('speed-select');

        // ─── Event Listeners ────────────────────────────────
        // addEventListener connects a function to a DOM event
        // When the event fires, the function (called a "callback") runs

        // Play/Pause button click
        btnPlay.addEventListener('click', togglePlayPause);

        // Seek bar interaction
        // 'input' fires while dragging, 'change' fires when released
        seekBar.addEventListener('input', function () {
            isSeeking = true;  // Flag to prevent timeupdate from moving the bar
        });
        seekBar.addEventListener('change', function () {
            if (audio && audio.duration && isFinite(audio.duration)) {
                // seekBar.value is 0-100, convert to seconds
                audio.currentTime = (seekBar.value / 100) * audio.duration;
            }
            isSeeking = false;
        });

        // Playback speed change
        speedSelect.addEventListener('change', function () {
            if (audio) {
                // playbackRate: 1.0 = normal, 0.5 = half speed, 2.0 = double
                audio.playbackRate = parseFloat(speedSelect.value);
            }
        });
    }

    /**
     * Load a new audio track from a URL.
     *
     * @param {string} url - The audio file URL (proxied through our backend)
     */
    function loadTrack(url) {
        // Create a new Audio object (or reuse existing one)
        if (audio) {
            audio.pause();
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onMetadataLoaded);
            audio.removeEventListener('ended', onEnded);
        }

        audio = new Audio(url);
        audio.playbackRate = parseFloat(speedSelect.value);

        // ─── Audio Events ────────────────────────────────────

        // 'timeupdate' fires ~4 times per second during playback
        // This is where we sync the transcript highlighting
        audio.addEventListener('timeupdate', onTimeUpdate);

        // 'loadedmetadata' fires when the browser knows the audio duration
        audio.addEventListener('loadedmetadata', onMetadataLoaded);

        // 'ended' fires when the audio finishes playing
        audio.addEventListener('ended', onEnded);

        // Reset UI
        btnPlay.textContent = '\u25B6';  // ▶ play symbol
        seekBar.value = 0;
        timeCurrent.textContent = '0:00';
        timeDuration.textContent = '0:00';
    }

    /**
     * Called every ~250ms during playback.
     * Updates the seek bar and dispatches a custom event for transcript sync.
     */
    function onTimeUpdate() {
        if (!audio || isSeeking) return;

        // Update seek bar position (convert seconds to 0-100 range)
        // Guard against NaN when duration isn't loaded yet
        if (audio.duration && isFinite(audio.duration)) {
            var progress = (audio.currentTime / audio.duration) * 100;
            seekBar.value = progress;
        }

        // Update time display
        timeCurrent.textContent = formatTime(audio.currentTime);

        // Dispatch custom event for transcript module to pick up
        // CustomEvent lets us attach data (the current time) to the event
        document.dispatchEvent(new CustomEvent('npr-timeupdate', {
            detail: { currentTime: audio.currentTime }
        }));
    }

    /**
     * Called when audio metadata is loaded (we now know the duration).
     */
    function onMetadataLoaded() {
        timeDuration.textContent = formatTime(audio.duration);
    }

    /**
     * Called when audio playback ends.
     */
    function onEnded() {
        btnPlay.textContent = '\u25B6';  // ▶ Reset to play icon
    }

    /**
     * Toggle between play and pause.
     */
    function togglePlayPause() {
        if (!audio) return;

        if (audio.paused) {
            audio.play();
            btnPlay.textContent = '\u23F8';  // ⏸ pause symbol
        } else {
            audio.pause();
            btnPlay.textContent = '\u25B6';  // ▶ play symbol
        }
    }

    /**
     * Seek to a specific time in the audio.
     *
     * @param {number} time - Time in seconds
     */
    function seekTo(time) {
        if (audio) {
            audio.currentTime = time;
            // Update the seek bar — but only if duration is known
            // (duration is NaN until audio metadata loads)
            if (audio.duration && isFinite(audio.duration)) {
                seekBar.value = (time / audio.duration) * 100;
            }
            timeCurrent.textContent = formatTime(time);
        }
    }

    /**
     * Get the current playback time.
     *
     * @returns {number} Current time in seconds
     */
    function getCurrentTime() {
        return audio ? audio.currentTime : 0;
    }

    /**
     * Format seconds into MM:SS string.
     * Example: 125.7 → "2:05"
     *
     * Math.floor() rounds down: 2.9 → 2
     * .padStart(2, '0') adds a leading zero: "5" → "05"
     */
    function formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return mins + ':' + secs.toString().padStart(2, '0');
    }

    // Public API
    return {
        init: init,
        loadTrack: loadTrack,
        seekTo: seekTo,
        getCurrentTime: getCurrentTime,
    };
})();
