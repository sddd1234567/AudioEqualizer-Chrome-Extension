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

async function muteTab(tabId, shouldMute) {
    try {
        // 獲取 tab 資訊確保它仍然存在
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
            await chrome.tabs.update(tabId, { muted: shouldMute });
            console.log(`Tab ${tabId} ${shouldMute ? 'muted' : 'unmuted'} successfully`);
        }
    } catch (error) {
        console.warn(`Could not ${shouldMute ? 'mute' : 'unmute'} tab ${tabId}: ${error.message}`);
        // 如果靜音失敗，拋出錯誤以便上層處理
        if (shouldMute) {
            throw error;
        }
    }
}

async function stopAudioProcessing() {
    if (!isProcessing && !activeTabId) return;

    console.log('Stopping audio processing...');

    // 停止 offscreen document 中的音頻處理
    if (await hasOffscreenDocument()) {
        chrome.runtime.sendMessage({
            type: 'STOP_AUDIO',
            target: 'offscreen'
        });
    }

    // 取消靜音原始 tab
    if (activeTabId) {
        await muteTab(activeTabId, false);
        activeTabId = null;
    }

    isProcessing = false;
    console.log('Audio processing stopped');
}

async function startOrUpdateAudioProcessing(tabId, gains, enabled) {
    if (!enabled) {
        await stopAudioProcessing();
        return;
    }

    console.log(`Starting/updating audio processing for tab ${tabId}`);

    // If we are already processing audio for a tab, just update the gains.
    if (isProcessing && activeTabId === tabId) {
        chrome.runtime.sendMessage({
            type: 'UPDATE_GAINS',
            target: 'offscreen',
            gains: gains
        });
        console.log('Updated gains for existing processing');
        return;
    }

    // Stop any existing processing before starting a new one.
    await stopAudioProcessing();

    activeTabId = tabId;

    try {
        // 首先靜音 tab，防止雙重音訊
        await muteTab(tabId, true);
        console.log(`Tab ${tabId} muted before starting capture`);

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

        isProcessing = true;
        console.log(`Audio processing started for tab ${tabId}`);

    } catch (error) {
        console.error('Error starting tab capture:', error.message);
        // 如果啟動失敗，確保清理狀態
        if (activeTabId) {
            await muteTab(activeTabId, false);
            activeTabId = null;
        }
        isProcessing = false;
        throw error;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ignore messages intended for the offscreen document
    if (request.target === 'offscreen') {
        return true;
    }

    if (request.type === 'APPLY_SETTINGS') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
            if (tab && tab.id) {
                try {
                    await startOrUpdateAudioProcessing(tab.id, request.gains, request.enabled);
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Failed to apply settings:', error);
                    sendResponse({ success: false, error: error.message });
                }
            } else {
                sendResponse({ success: false, error: 'No active tab found' });
            }
        });
        return true; // 保持消息通道開放以便異步回應
    }
    return true;
});

// Stop processing when the active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (activeTabId && activeTabId !== activeInfo.tabId) {
        console.log(`Active tab changed from ${activeTabId} to ${activeInfo.tabId}`);
        await stopAudioProcessing();
    }
});

// Stop processing when the tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === activeTabId) {
        console.log(`Active tab ${tabId} was closed`);
        await stopAudioProcessing();
    }
});

// Stop processing if tab is updated (e.g. reloaded or URL changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.status === 'loading') {
        console.log(`Active tab ${tabId} is reloading`);
        await stopAudioProcessing();
    }
});

// 當擴展被停用或重新載入時清理
chrome.runtime.onSuspend.addListener(async () => {
    console.log('Extension is being suspended, cleaning up...');
    await stopAudioProcessing();
});