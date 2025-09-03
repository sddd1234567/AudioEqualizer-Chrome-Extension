
let audioContext;
let streamSource;
let filters = [];
const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
let audioStream; // Keep a reference to the stream to stop tracks later

chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message) {
    if (message.target !== 'offscreen') {
        return;
    }
    switch (message.type) {
        case 'START_AUDIO':
            startAudio(message.streamId, message.gains);
            break;
        case 'UPDATE_GAINS':
            updateGains(message.gains);
            break;
        case 'STOP_AUDIO':
            stopAudio();
            break;
        default:
            console.warn(`Unexpected message type received: '${message.type}'.`);
    }
    return true;
}

async function startAudio(streamId, initialGains) {
    if (audioContext) {
        await stopAudio();
    }

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId,
                },
            },
            video: false
        });

        const audio = new Audio();
        audio.srcObject = audioStream;
        // Don't play the audio through the offscreen document's output.
        // It will be processed by the audio context and played on the captured tab.
        audio.muted = true;

        audioContext = new AudioContext();
        streamSource = audioContext.createMediaStreamSource(audioStream);

        filters = FREQUENCIES.map((freq, i) => {
            const filter = audioContext.createBiquadFilter();
            filter.type = i === 0 ? 'lowshelf' : (i === FREQUENCIES.length - 1 ? 'highshelf' : 'peaking');
            filter.frequency.value = freq;
            filter.Q.value = 1.41;
            filter.gain.value = initialGains[freq] || 0;
            return filter;
        });

        // Chain the nodes together
        streamSource.connect(filters[0]);
        for (let i = 0; i < filters.length - 1; i++) {
            filters[i].connect(filters[i + 1]);
        }
        // Connect the last filter to the audio context's destination (the speakers)
        filters[filters.length - 1].connect(audioContext.destination);

    } catch (error) {
        console.error('Error starting audio in offscreen document:', error);
    }
}

function updateGains(gains) {
    if (!filters || filters.length === 0) return;

    filters.forEach((filter, i) => {
        const freq = FREQUENCIES[i];
        if (gains && gains[freq] !== undefined) {
            // Use setTargetAtTime for smooth gain transitions
            filter.gain.setTargetAtTime(gains[freq], audioContext.currentTime, 0.015);
        }
    });
}

function stopAudio() {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    if (streamSource) {
        streamSource.disconnect();
        streamSource = null;
    }
    if (filters && filters.length > 0) {
        filters.forEach(filter => filter.disconnect());
        filters = [];
    }
    if (audioContext) {
        return audioContext.close().then(() => {
            audioContext = null;
        });
    }
    return Promise.resolve();
}
