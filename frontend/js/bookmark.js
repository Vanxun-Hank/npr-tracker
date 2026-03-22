/**
 * Bookmark Module — Position Persistence
 * ========================================
 * This module saves your reading/listening position so you can
 * pick up right where you left off next time.
 *
 * KEY CONCEPT: localStorage
 * - localStorage is a simple key-value store built into every browser
 * - Data persists even after closing the browser
 * - It can only store strings, so we use JSON.stringify/parse
 *   to convert objects to/from strings
 * - Each website gets its own localStorage (sites can't read each other's data)
 *
 * You'll learn: localStorage API, JSON serialization, timers
 */

// Create a namespace to avoid polluting the global scope
// window.NPR is our app's global object — all modules attach to it
window.NPR = window.NPR || {};

window.NPR.Bookmark = (function () {
    // The key we use in localStorage to store all bookmarks
    const STORAGE_KEY = 'npr-bookmarks';

    // Timer reference for auto-saving (we'll save position every 5 seconds)
    let autoSaveTimer = null;

    /**
     * Get all saved bookmarks from localStorage.
     *
     * localStorage.getItem() returns a string or null.
     * JSON.parse() converts the string back into a JavaScript object.
     */
    function getAllBookmarks() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};

        try {
            return JSON.parse(raw);
        } catch (e) {
            // If the stored data is corrupted, start fresh
            console.warn('Bookmark data corrupted, resetting:', e);
            return {};
        }
    }

    /**
     * Save all bookmarks back to localStorage.
     *
     * JSON.stringify() converts a JavaScript object into a string,
     * because localStorage can only store strings.
     */
    function saveAllBookmarks(bookmarks) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
        } catch (e) {
            // localStorage can throw in private browsing mode or when full
            console.warn('Failed to save bookmarks:', e);
        }
    }

    /**
     * Save a bookmark for a specific episode.
     *
     * @param {string} episodeUrl - The episode's URL (used as unique key)
     * @param {number} timestamp - Current playback time in seconds
     * @param {number} sentenceIndex - Index of the current sentence (optional)
     */
    function saveBookmark(episodeUrl, timestamp, sentenceIndex) {
        const bookmarks = getAllBookmarks();

        bookmarks[episodeUrl] = {
            timestamp: timestamp,
            sentenceIndex: sentenceIndex || 0,
            savedAt: new Date().toISOString(),  // ISO format: "2024-01-15T10:30:00.000Z"
        };

        saveAllBookmarks(bookmarks);
    }

    /**
     * Get the saved bookmark for a specific episode.
     * Returns null if no bookmark exists.
     */
    function getBookmark(episodeUrl) {
        const bookmarks = getAllBookmarks();
        return bookmarks[episodeUrl] || null;
    }

    /**
     * Start auto-saving the current position every 5 seconds.
     *
     * setInterval() calls a function repeatedly at a fixed time interval.
     * We store the timer ID so we can stop it later with clearInterval().
     *
     * @param {string} episodeUrl - Current episode URL
     * @param {Function} getTimeFn - Function that returns current playback time
     */
    function startAutoSave(episodeUrl, getTimeFn) {
        // Stop any existing auto-save first
        stopAutoSave();

        autoSaveTimer = setInterval(function () {
            const currentTime = getTimeFn();
            if (currentTime > 0) {
                saveBookmark(episodeUrl, currentTime);
            }
        }, 5000);  // 5000 milliseconds = 5 seconds
    }

    /**
     * Stop the auto-save timer.
     */
    function stopAutoSave() {
        if (autoSaveTimer) {
            clearInterval(autoSaveTimer);
            autoSaveTimer = null;
        }
    }

    /**
     * Delete a bookmark for a specific episode.
     */
    function deleteBookmark(episodeUrl) {
        const bookmarks = getAllBookmarks();
        delete bookmarks[episodeUrl];
        saveAllBookmarks(bookmarks);
    }

    // Return public API — only these functions are accessible from outside
    // This is called the "revealing module pattern"
    return {
        saveBookmark: saveBookmark,
        getBookmark: getBookmark,
        getAllBookmarks: getAllBookmarks,
        deleteBookmark: deleteBookmark,
        startAutoSave: startAutoSave,
        stopAutoSave: stopAutoSave,
    };
})();
