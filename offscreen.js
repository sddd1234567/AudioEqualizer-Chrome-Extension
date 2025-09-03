
let audioContext;
let streamSource;
let filters = [];
// More granular frequencies for 20 bands
const FREQUENCIES = [
    32, 45, 63, 87, 123, 173, 243, 341, 479, 672,
    944, 1325, 1860, 2610, 3663, 5141, 7216, 10126, 14212, 16000
];
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
      // No longer needed: console.warn(`Unexpected message type received: '${message.type}'.`);
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

    const audio = document.getElementById('source-audio');
    audio.srcObject = audioStream;
    audio.muted = true; // Mute the source audio element to prevent double playback

    audioContext = new AudioContext();
    streamSource = audioContext.createMediaStreamSource(audioStream);
    
    filters = FREQUENCIES.map((freq, i) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = 'peaking';
      if (i === 0) {
        filter.type = 'lowshelf';
      }
      if (i === FREQUENCIES.length - 1) {
        filter.type = 'highshelf';
      }
      filter.frequency.value = freq;
      filter.Q.value = 4; // Increased Q for better precision
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
  const audio = document.getElementById('source-audio');
  if (audio && audio.srcObject) {
    audio.pause();
    audio.srcObject.getTracks().forEach(track => track.stop());
    audio.srcObject = null;
  }

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

