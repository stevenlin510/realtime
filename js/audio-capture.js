import { CONFIG } from './config.js';
import { floatTo16BitPCM, int16ArrayToBase64 } from './utils.js';

/**
 * Manages microphone capture and audio encoding
 */
export class AudioCapture {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.sourceNode = null;
        this.workletNode = null;
        this.isCapturing = false;
        this.onAudioData = null;
    }

    /**
     * Initialize audio capture (request microphone permission)
     * @returns {Promise<void>}
     */
    async initialize() {
        // Create AudioContext with target sample rate
        this.audioContext = new AudioContext({
            sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
        });

        // Request microphone access
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: CONFIG.AUDIO.CHANNELS,
                sampleRate: CONFIG.AUDIO.SAMPLE_RATE,
                echoCancellation: true,
                noiseSuppression: true,
            },
        });

        // Load the capture worklet
        await this.audioContext.audioWorklet.addModule('worklets/capture-processor.js');

        // Create source from microphone
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

        // Create worklet node
        this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor');

        // Handle audio data from worklet
        this.workletNode.port.onmessage = (event) => {
            if (event.data.type === 'audio' && this.isCapturing && this.onAudioData) {
                const base64Audio = int16ArrayToBase64(event.data.data);
                this.onAudioData(base64Audio);
            }
        };

        // Connect the audio graph (but don't start capturing yet)
        this.sourceNode.connect(this.workletNode);
        // Note: We don't connect to destination to avoid feedback
    }

    /**
     * Start capturing audio
     */
    startCapture() {
        if (!this.audioContext || !this.workletNode) {
            throw new Error('AudioCapture not initialized');
        }

        // Resume AudioContext if suspended (required for Safari)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isCapturing = true;
    }

    /**
     * Stop capturing audio
     */
    stopCapture() {
        this.isCapturing = false;
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.isCapturing = false;

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
