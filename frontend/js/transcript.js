/**
 * Transcript Module — Auto-Highlighting
 * ========================================
 * THE CORE FEATURE! This module renders the transcript and highlights
 * the sentence currently being spoken as the audio plays.
 *
 * KEY CONCEPT: Binary Search
 * - We have a sorted list of sentences with start/end timestamps
 * - Given the current playback time, we need to find which sentence is active
 * - Linear search (checking one by one) would work but is slow: O(n)
 * - Binary search cuts the search space in half each step: O(log n)
 * - For 500 sentences: linear = ~250 checks avg, binary = ~9 checks max!
 *
 * KEY CONCEPT: DOM Manipulation
 * - The Document Object Model (DOM) is the browser's representation of HTML
 * - We create elements with document.createElement()
 * - We add them to the page with parent.appendChild()
 * - We change appearance by adding/removing CSS classes
 *
 * KEY CONCEPT: Scroll Into View
 * - element.scrollIntoView() makes the browser scroll to show an element
 * - The 'smooth' behavior creates an animated scroll effect
 *
 * You'll learn: binary search, DOM manipulation, event delegation, scroll APIs
 */

window.NPR = window.NPR || {};

window.NPR.Transcript = (function () {
    // Store the transcript data and state
    var sentences = [];          // Array of sentence objects from the API
    var container = null;        // The DOM element that holds the transcript
    var activeSentenceIndex = -1; // Index of the currently highlighted sentence
    var sentenceElements = [];   // Array of <p> DOM elements we created

    /**
     * Initialize the transcript module.
     */
    function init() {
        container = document.getElementById('transcript-container');

        // Listen for the custom timeupdate event from the Player module
        // This is how Player and Transcript communicate
        document.addEventListener('npr-timeupdate', function (event) {
            // event.detail contains the data we attached in player.js
            var currentTime = event.detail.currentTime;
            highlightAtTime(currentTime);
        });
    }

    /**
     * Safely clear all child elements from a container.
     * This is safer than innerHTML = '' because it doesn't parse HTML.
     *
     * KEY CONCEPT: XSS (Cross-Site Scripting) Prevention
     * - innerHTML can execute malicious scripts if given untrusted content
     * - Using DOM methods (removeChild, createElement, textContent) is safer
     * - Always use textContent for plain text, never innerHTML with user data
     */
    function clearContainer() {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

    /**
     * Load and render transcript data from the API.
     *
     * @param {Object} data - Transcript data: { sentences: [{text, start, end, words}] }
     */
    function loadTranscript(data) {
        sentences = data.sentences || [];
        activeSentenceIndex = -1;
        sentenceElements = [];

        // Clear the container safely (no innerHTML!)
        clearContainer();

        if (sentences.length === 0) {
            var emptyMsg = document.createElement('p');
            emptyMsg.className = 'empty-state';
            emptyMsg.textContent = 'No transcript available.';
            container.appendChild(emptyMsg);
            return;
        }

        // Create a DOM element for each sentence
        sentences.forEach(function (sentence, index) {
            // document.createElement() creates a new HTML element in memory
            var p = document.createElement('p');
            p.className = 'transcript-sentence';

            // data-* attributes let us store custom data on HTML elements
            // We'll use these to find which sentence was clicked
            p.setAttribute('data-index', index);
            p.setAttribute('data-start', sentence.start);
            p.setAttribute('data-end', sentence.end);

            // Render each word as a clickable <span>
            // This enables word-level interactions (tapping to save vocab)
            if (sentence.words && sentence.words.length > 0) {
                sentence.words.forEach(function (wordObj) {
                    var span = document.createElement('span');
                    span.className = 'transcript-word';
                    span.textContent = wordObj.word + ' ';
                    span.setAttribute('data-word', wordObj.word);
                    span.setAttribute('data-start', wordObj.start);
                    span.setAttribute('data-end', wordObj.end);
                    p.appendChild(span);
                });
            } else {
                // Fallback if no word-level data — use textContent (safe!)
                p.textContent = sentence.text;
            }

            // Click on a sentence → seek audio to that point
            p.addEventListener('click', function (event) {
                // If a word was clicked, don't also trigger the sentence click
                // (the word click is handled by vocab.js)
                if (event.target.classList.contains('transcript-word')) {
                    return;  // Let vocab.js handle it
                }
                // Seek the audio player to this sentence's start time
                window.NPR.Player.seekTo(sentence.start);
            });

            container.appendChild(p);
            sentenceElements.push(p);
        });
    }

    /**
     * Find and highlight the sentence at the given playback time.
     *
     * @param {number} currentTime - Current audio playback time in seconds
     */
    function highlightAtTime(currentTime) {
        if (sentences.length === 0) return;

        // Use binary search to efficiently find the current sentence
        var newIndex = findCurrentSentence(sentences, currentTime);

        // Only update DOM if the active sentence changed
        // (DOM updates are expensive — avoid unnecessary ones!)
        if (newIndex !== activeSentenceIndex) {
            // Remove highlight from the old sentence
            if (activeSentenceIndex >= 0 && sentenceElements[activeSentenceIndex]) {
                sentenceElements[activeSentenceIndex].classList.remove('active');
            }

            activeSentenceIndex = newIndex;

            // newIndex = -1 means we're before the first sentence (no highlight)
            if (newIndex >= 0 && sentenceElements[newIndex]) {
                // Add highlight to the new sentence
                sentenceElements[newIndex].classList.add('active');

                // Scroll to keep the active sentence visible
                // 'smooth' creates an animated scroll effect
                // 'center' puts the sentence in the middle of the screen
                sentenceElements[newIndex].scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }
        }
    }

    /**
     * Binary Search — find which sentence is playing at a given time.
     *
     * HOW BINARY SEARCH WORKS:
     * 1. Start with the full range [0, n-1]
     * 2. Check the middle element
     * 3. If currentTime < middle.start → search left half
     * 4. If currentTime > middle.end → search right half
     * 5. Otherwise → we found it!
     * 6. Repeat until found
     *
     * Think of it like guessing a number between 1-100:
     * "Is it more or less than 50?" → "More" → "More or less than 75?" → etc.
     * You find the answer in at most 7 guesses instead of 100!
     *
     * @param {Array} sentenceList - Sorted array of {start, end} objects
     * @param {number} currentTime - Time to search for
     * @returns {number} Index of the matching sentence
     */
    function findCurrentSentence(sentenceList, currentTime) {
        var low = 0;
        var high = sentenceList.length - 1;

        while (low <= high) {
            // Find the middle index
            var mid = Math.floor((low + high) / 2);

            if (currentTime < sentenceList[mid].start) {
                // Current time is before this sentence → search earlier
                high = mid - 1;
            } else if (currentTime > sentenceList[mid].end) {
                // Current time is after this sentence → search later
                low = mid + 1;
            } else {
                // Current time is within this sentence → found it!
                return mid;
            }
        }

        // If we didn't find an exact match, we're in a gap between sentences.
        // - If currentTime is before all sentences, return -1 (no highlight)
        // - If we're in a short gap (< 2s), keep highlighting the previous sentence
        //   (natural pause between sentences — keeps the highlight stable)
        // - If the gap is long (>= 2s), return -1 (likely an ad break or music)
        if (low === 0) return -1;  // Before first sentence starts

        var prevEnd = sentenceList[low - 1].end;
        if (currentTime - prevEnd < 2.0) {
            return low - 1;  // Short gap — keep previous sentence highlighted
        }
        return -1;  // Long gap — no highlight (ad break, music, silence)
    }

    /**
     * Get the currently active sentence index.
     * Used by bookmark module to save position.
     */
    function getActiveSentenceIndex() {
        return activeSentenceIndex;
    }

    // Public API
    return {
        init: init,
        loadTranscript: loadTranscript,
        highlightAtTime: highlightAtTime,
        getActiveSentenceIndex: getActiveSentenceIndex,
    };
})();
