import { CONFIG } from './config.js';
import { base64ToInt16Array } from './utils.js';

/**
 * Manages streaming audio playback
 */
export class AudioPlayback {
    constructor() {
        this.audioContext = null;
        this.workletNode = null;
        this.isInitialized = false;
        this.onPlaybackDone = null;
    }

    /**
     * Initialize audio playback
     * @returns {Promise<void>}
     */
    async initialize() {
        // Create AudioContext with target sample rate
        this.audioContext = new AudioContext({
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
        });

        // Load the playback worklet
        await this.audioContext.audioWorklet.addModule('worklets/playback-processor.js');

        // Create worklet node
        this.workletNode = new AudioWorkletNode(this.audioContext, 'playback-processor');

        // Handle messages from worklet
        this.workletNode.port.onmessage = (event) => {
            if (event.data.type === 'playbackDone' && this.onPlaybackDone) {
                this.onPlaybackDone();
            }
        };

        // Connect to speakers
        this.workletNode.connect(this.audioContext.destination);

        this.isInitialized = true;
    }

    /**
     * Queue audio for playback
     * @param {string} base64Audio - Base64 encoded PCM16 audio
     */
    playAudio(base64Audio) {
        if (!this.isInitialized) {
            throw new Error('AudioPlayback not initialized');
        }

        // Resume AudioContext if suspended (required for Safari)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Decode and send to worklet
        const int16Array = base64ToInt16Array(base64Audio);
        this.workletNode.port.postMessage({
            type: 'audio',
            data: int16Array,
        });
    }

    /**
     * Clear the playback buffer (for interruptions)
     */
    clearBuffer() {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'clear' });
        }
    }

    /**
     * Stop playback and clear buffer
     */
    stop() {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
            this.workletNode.port.postMessage({ type: 'clear' });
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isInitialized = false;
    }
}
