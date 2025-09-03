
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

let activeTabId = null;
let isProcessing = false;

// A function to determine if an offscreen document is currently open.
async function hasOffscreenDocument() {
    if ('getContexts' in chrome.runtime) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
        });
        return contexts.length > 0;
    } else {
        // Fallback for older Chrome versions.
        const clients = await self.clients.matchAll();
        return clients.some(client => client.url.endsWith(OFFSCREEN_DOCUMENT_PATH));
    }
}

async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        return;
    }
    await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'The offscreen document is required to process audio from tab capture.',
    });
}

async function stopAudioProcessing() {
    if (!isProcessing && !activeTabId) return;

    if (activeTabId) {
        try {
            await chrome.tabs.update(activeTabId, { muted: false });
        } catch (error) {
            console.warn(`Could not unmute tab ${activeTabId}: ${error.message}`);
        }
        activeTabId = null;
    }

    if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({
            type: 'STOP_AUDIO',
            target: 'offscreen'
        });
    }
    isProcessing = false;
}

async function startOrUpdateAudioProcessing(tabId, gains, enabled) {
    if (!enabled) {
        await stopAudioProcessing();
        return;
    }

    // If we are already processing audio for a tab, just update the gains.
    if (isProcessing && activeTabId === tabId) {
        chrome.runtime.sendMessage({
            type: 'UPDATE_GAINS',
            target: 'offscreen',
            gains: gains
        });
        return;
    }

    // Stop any existing processing before starting a new one.
    await stopAudioProcessing();

    activeTabId = tabId;

    try {
        await setupOffscreenDocument();

        // Get a media stream ID for the tab.
        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tabId
        });

        // Send the stream ID to the offscreen document to start audio processing.
        chrome.runtime.sendMessage({
            type: 'START_AUDIO',
            target: 'offscreen',
            streamId: streamId,
            gains: gains
        });

        // Mute the tab to avoid hearing both original and processed audio.
        await chrome.tabs.update(tabId, { muted: true });
        isProcessing = true;

    } catch (error) {
        console.error('Error starting tab capture:', error.message);
        await stopAudioProcessing();
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ignore messages intended for the offscreen document
    if (request.target === 'offscreen') {
        return true;
    }

    if (request.type === 'APPLY_SETTINGS') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            if (tab && tab.id) {
                startOrUpdateAudioProcessing(tab.id, request.gains, request.enabled);
            }
        });
    }
    return true;
});


// Stop processing when the active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeTabId && activeTabId !== activeInfo.tabId) {
        await stopAudioProcessing();
    }
});

// Stop processing when the tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === activeTabId) {
        await stopAudioProcessing();
    }
});

// Stop processing if tab is updated (e.g. reloaded or URL changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.status === 'loading') {
        await stopAudioProcessing();
    }
});
