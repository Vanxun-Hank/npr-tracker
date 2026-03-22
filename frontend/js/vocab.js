/**
 * Vocabulary Module — Word Saving
 * =================================
 * Lets you tap words in the transcript to save them for later review.
 * Perfect for building your English vocabulary!
 *
 * KEY CONCEPT: Event Delegation
 * - Instead of adding a click listener to EVERY word span (could be 1000+),
 *   we add ONE listener to the parent container
 * - When a word is clicked, the event "bubbles up" to the parent
 * - We check event.target to see which word was actually clicked
 * - This is much more memory-efficient!
 *
 * KEY CONCEPT: Array Methods
 * - .filter() creates a new array with only elements that pass a test
 * - .sort() arranges elements in order
 * - .findIndex() finds the position of an element
 * - These are essential tools for working with data in JavaScript
 *
 * You'll learn: event delegation, localStorage, array methods, DOM rendering
 */

window.NPR = window.NPR || {};

window.NPR.Vocab = (function () {
    var STORAGE_KEY = 'npr-vocabulary';
    var currentEpisodeName = '';

    // DOM elements
    var vocabListContainer = null;
    var wordPopup = null;
    var wordPopupText = null;
    var btnSaveWord = null;
    var btnCancelWord = null;

    // The word currently being considered for saving
    var pendingWord = null;

    /**
     * Initialize the vocabulary module.
     */
    function init() {
        vocabListContainer = document.getElementById('vocab-list');
        wordPopup = document.getElementById('word-popup');
        wordPopupText = document.getElementById('word-popup-text');
        btnSaveWord = document.getElementById('btn-save-word');
        btnCancelWord = document.getElementById('btn-cancel-word');

        // ─── Event Delegation ─────────────────────────────────
        // Listen for clicks on the transcript container
        // instead of on each individual word
        var transcriptContainer = document.getElementById('transcript-container');
        transcriptContainer.addEventListener('click', function (event) {
            // Check if the clicked element is a word span
            // .closest() walks up the DOM tree to find a matching ancestor
            var wordSpan = event.target.closest('.transcript-word');
            if (wordSpan) {
                onWordClick(wordSpan);
            }
        });

        // Save/Cancel buttons on the popup
        btnSaveWord.addEventListener('click', function () {
            if (pendingWord) {
                saveWord(pendingWord);
                hidePopup();
            }
        });

        btnCancelWord.addEventListener('click', hidePopup);

        // Render the vocab list on init (in case there are saved words)
        renderVocabList();
    }

    /**
     * Set the current episode name (shown in saved word context).
     */
    function setEpisodeName(name) {
        currentEpisodeName = name;
    }

    /**
     * Handle a word being clicked in the transcript.
     * Shows a popup asking if the user wants to save it.
     */
    function onWordClick(wordSpan) {
        var word = wordSpan.getAttribute('data-word') || wordSpan.textContent.trim();

        // Clean the word — remove punctuation from the edges
        // .replace() with a regex removes non-letter characters
        var cleanWord = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
        if (!cleanWord) return;

        // Find the parent sentence for context
        var sentenceElement = wordSpan.closest('.transcript-sentence');
        var sentenceText = sentenceElement ? sentenceElement.textContent.trim() : '';

        // Store the word info for saving
        pendingWord = {
            word: cleanWord,
            sentence: sentenceText,
            episodeName: currentEpisodeName,
        };

        // Show the popup
        wordPopupText.textContent = 'Save "' + cleanWord + '"?';
        wordPopup.style.display = 'flex';
    }

    /**
     * Hide the word save popup.
     */
    function hidePopup() {
        wordPopup.style.display = 'none';
        pendingWord = null;
    }

    /**
     * Save a word to the vocabulary list in localStorage.
     */
    function saveWord(wordInfo) {
        var vocab = getAllWords();

        // Check if the word is already saved (avoid duplicates)
        var exists = vocab.findIndex(function (item) {
            return item.word.toLowerCase() === wordInfo.word.toLowerCase();
        });

        if (exists >= 0) {
            // Word already saved — update the sentence context
            vocab[exists].sentence = wordInfo.sentence;
            vocab[exists].savedAt = new Date().toISOString();
        } else {
            // Add new word
            vocab.push({
                word: wordInfo.word,
                sentence: wordInfo.sentence,
                episodeName: wordInfo.episodeName,
                savedAt: new Date().toISOString(),
            });
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(vocab));
        } catch (e) {
            console.warn('Failed to save vocabulary:', e);
        }
        renderVocabList();
    }

    /**
     * Get all saved words from localStorage.
     *
     * @returns {Array} Array of word objects
     */
    function getAllWords() {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];

        try {
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }

    /**
     * Delete a word from the vocabulary list by its text value.
     *
     * We delete by word text (not index) because the display is sorted
     * by date, which may differ from the storage order. Using an index
     * from the sorted display to splice the unsorted storage array
     * would delete the wrong word!
     *
     * @param {string} wordText - The word to delete
     */
    function deleteWord(wordText) {
        var vocab = getAllWords();

        // .filter() creates a new array excluding the word to delete
        vocab = vocab.filter(function (item) {
            return item.word.toLowerCase() !== wordText.toLowerCase();
        });

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(vocab));
        } catch (e) {
            console.warn('Failed to save vocabulary:', e);
        }
        renderVocabList();
    }

    /**
     * Render the vocabulary list in the Vocabulary view.
     *
     * This function creates DOM elements for each saved word.
     * It's called whenever words are added or deleted.
     */
    function renderVocabList() {
        if (!vocabListContainer) return;

        // Clear existing content safely
        while (vocabListContainer.firstChild) {
            vocabListContainer.removeChild(vocabListContainer.firstChild);
        }

        var vocab = getAllWords();

        if (vocab.length === 0) {
            var emptyMsg = document.createElement('p');
            emptyMsg.className = 'empty-state';
            emptyMsg.textContent = 'No saved words yet. Tap words in transcripts to save them!';
            vocabListContainer.appendChild(emptyMsg);
            return;
        }

        // Sort by most recently saved (newest first)
        // .sort() with a compare function:
        // - Return negative → a comes first
        // - Return positive → b comes first
        // - Return 0 → keep original order
        vocab.sort(function (a, b) {
            return new Date(b.savedAt) - new Date(a.savedAt);
        });

        // Create a card for each word
        vocab.forEach(function (item, index) {
            var card = document.createElement('div');
            card.className = 'vocab-card';

            // Word heading
            var wordEl = document.createElement('div');
            wordEl.className = 'vocab-word';
            wordEl.textContent = item.word;
            card.appendChild(wordEl);

            // Sentence context (italicized)
            if (item.sentence) {
                var sentenceEl = document.createElement('div');
                sentenceEl.className = 'vocab-sentence';
                sentenceEl.textContent = '"' + item.sentence + '"';
                card.appendChild(sentenceEl);
            }

            // Episode name
            if (item.episodeName) {
                var episodeEl = document.createElement('div');
                episodeEl.className = 'vocab-episode';
                episodeEl.textContent = item.episodeName;
                card.appendChild(episodeEl);
            }

            // Delete button (× symbol)
            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'vocab-delete';
            deleteBtn.textContent = '\u00D7';  // × symbol
            deleteBtn.setAttribute('aria-label', 'Delete word');

            // We use a closure here to capture the correct word
            deleteBtn.addEventListener('click', (function (word) {
                return function (event) {
                    event.stopPropagation();  // Don't trigger card click
                    deleteWord(word);
                };
            })(item.word));

            card.appendChild(deleteBtn);
            vocabListContainer.appendChild(card);
        });
    }

    // Public API
    return {
        init: init,
        setEpisodeName: setEpisodeName,
        renderVocabList: renderVocabList,
    };
})();
