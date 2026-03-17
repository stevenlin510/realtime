import { AudioCapture } from './audio-capture.js';
import { AudioPlayback } from './audio-playback.js';
import { WebSocketManager } from './websocket-manager.js';
import { UIController } from './ui-controller.js';

/**
 * Main application orchestrator
 */
class App {
    constructor() {
        this.audioCapture = new AudioCapture();
        this.audioPlayback = new AudioPlayback();
        this.wsManager = new WebSocketManager();
        this.ui = new UIController();

        this.isInitialized = false;

        // Debug: buffer to save AI audio response
        this.debugAudioBuffer = [];

        this.setupEventHandlers();
        this.setupCleanup();
    }

    /**
     * Wire up event handlers between modules
     */
    setupEventHandlers() {
        // UI events
        this.ui.onConnect = async (voice, systemPrompt) => {
            await this.connect(voice, systemPrompt);
        };

        this.ui.onStartRecording = () => {
            this.startRecording();
        };

        this.ui.onStopRecording = () => {
            this.stopRecording();
        };

        this.ui.onNewChat = async () => {
            await this.newChat();
        };

        // Audio capture events
        this.audioCapture.onAudioData = (base64Audio) => {
            this.wsManager.sendAudio(base64Audio);
        };

        // Audio playback events
        this.audioPlayback.onPlaybackDone = () => {
            this.ui.setAiSpeaking(false);
            this.ui.setAiWaveLevel(0);
        };

        this.audioPlayback.onPlaybackLevel = (level) => {
            this.ui.setAiWaveLevel(level);
        };

        this.audioPlayback.onPlaybackStateChange = (isPlaying) => {
            this.ui.setAiSpeaking(isPlaying);
            if (!isPlaying) {
                this.ui.setAiWaveLevel(0);
            }
        };

        // WebSocket events
        this.wsManager.onConnectionChange = (status) => {
            this.ui.updateConnectionStatus(status);

            if (status === 'connected') {
                this.ui.showChatInterface();
                this.ui.enablePTT();
            } else if (status === 'disconnected' || status === 'error') {
                this.ui.disablePTT();
            }
        };

        this.wsManager.onSessionCreated = (session) => {
            console.log('Session configured:', session);
        };

        this.wsManager.onAudioDelta = (base64Audio) => {
            // Stream playback immediately while still keeping a debug copy.
            this.debugAudioBuffer.push(base64Audio);
            this.audioPlayback.playAudio(base64Audio);
            if (!this.ui.currentAiMessageId) {
                this.ui.startAiMessage();
            }
        };

        this.wsManager.onTranscriptDelta = (text, itemId) => {
            if (!this.ui.currentAiMessageId) {
                this.ui.startAiMessage();
            }
            this.ui.appendToAiMessage(text);
        };

        this.wsManager.onUserTranscript = (text, itemId) => {
            this.ui.addUserMessage(text);
        };

        this.wsManager.onResponseDone = () => {
            this.ui.finishAiMessage();

            // Save audio to server
            this.saveDebugAudio();
        };

        this.wsManager.onError = (message) => {
            this.ui.showError(message);
        };
    }

    /**
     * Connect to the API and initialize audio
     * @param {string} voice
     * @param {string} systemPrompt
     */
    async connect(voice, systemPrompt) {
        try {
            // Initialize audio modules first
            if (!this.isInitialized) {
                await this.initializeAudio();
            }

            // Connect to WebSocket proxy (API key is on server)
            await this.wsManager.connect(voice, systemPrompt);
        } catch (error) {
            console.error('Connection failed:', error);

            if (error.name === 'NotAllowedError') {
                this.ui.showError('Microphone access denied. Please allow microphone access and try again.');
            } else if (error.message?.includes('getUserMedia')) {
                this.ui.showError('Could not access microphone. Please check your browser permissions.');
            } else {
                this.ui.showError('Connection failed. Please check your API key and try again.');
            }

            this.ui.updateConnectionStatus('error');
        }
    }

    /**
     * Initialize audio capture and playback
     */
    async initializeAudio() {
        await this.audioCapture.initialize();
        await this.audioPlayback.initialize();
        this.isInitialized = true;
    }

    /**
     * Start recording audio
     */
    startRecording() {
        // Cancel any in-progress AI response on the server
        this.wsManager.cancelResponse();

        // Clear any playing audio when user starts speaking
        this.audioPlayback.clearBuffer();
        this.ui.setAiSpeaking(false);
        this.ui.setAiWaveLevel(0);

        // Cancel any in-progress AI response in UI
        this.ui.finishAiMessage();

        this.audioCapture.startCapture();
    }

    /**
     * Stop recording and request response
     */
    stopRecording() {
        this.audioCapture.stopCapture();

        const submitStatus = this.wsManager.commitAudioAndRespond();
        const turnAccepted = submitStatus.sent || submitStatus.queued;
        if (!turnAccepted) {
            return;
        }

        // Show user message placeholder immediately (before AI responds)
        this.ui.startUserMessage();

        // Clear buffers for new response
        this.debugAudioBuffer = [];
    }

    /**
     * Start a new chat - clear transcript and reset session
     */
    async newChat() {
        // Stop and clear audio buffers
        this.audioPlayback.stop();
        this.ui.setAiSpeaking(false);
        this.ui.setAiWaveLevel(0);

        // Clear UI transcript
        this.ui.clearTranscript();

        // Reset WebSocket session for fresh conversation
        try {
            await this.wsManager.resetSession();
        } catch (error) {
            console.error('Failed to reset session:', error);
            this.ui.showError('Failed to start new chat. Please try again.');
        }
    }

    /**
     * Debug: Save accumulated audio to server as tmp.wav
     */
    saveDebugAudio() {
        if (this.debugAudioBuffer.length === 0) {
            console.log('Debug: No audio to save');
            return;
        }

        // Decode all base64 chunks and combine
        const allChunks = [];
        for (const base64 of this.debugAudioBuffer) {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const int16Array = new Int16Array(bytes.buffer);
            allChunks.push(int16Array);
        }

        // Calculate total length
        const totalLength = allChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combinedAudio = new Int16Array(totalLength);

        // Combine all chunks
        let offset = 0;
        for (const chunk of allChunks) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
        }

        // Create WAV file
        const wavBlob = this.createWavBlob(combinedAudio, 24000);

        // Save to server
        fetch('/save-audio', {
            method: 'POST',
            body: wavBlob,
        }).then(response => {
            if (response.ok) {
                console.log(`Debug: Saved ${totalLength} samples (${(totalLength / 24000).toFixed(2)}s) to tmp.wav`);
            } else {
                console.error('Debug: Failed to save audio');
            }
        }).catch(err => {
            console.error('Debug: Error saving audio:', err);
        });
    }

    /**
     * Create a WAV blob from Int16 PCM data
     * @param {Int16Array} samples
     * @param {number} sampleRate
     * @returns {Blob}
     */
    createWavBlob(samples, sampleRate) {
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = samples.length * (bitsPerSample / 8);
        const fileSize = 44 + dataSize;

        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, fileSize - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Write PCM data
        const dataView = new Int16Array(buffer, 44);
        dataView.set(samples);

        return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Set up cleanup on page unload
     */
    setupCleanup() {
        window.addEventListener('beforeunload', () => {
            this.destroy();
        });
    }

    /**
     * Clean up all resources
     */
    destroy() {
        this.audioCapture.destroy();
        this.audioPlayback.destroy();
        this.wsManager.disconnect();
        this.ui.destroy();
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
