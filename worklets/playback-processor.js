/**
 * AudioWorklet processor for streaming audio playback
 * Runs on a dedicated audio thread for smooth, non-blocking playback
 */
class PlaybackProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.chunkQueue = [];
        this.currentChunk = null;
        this.currentChunkIndex = 0;
        this.queuedSamples = 0;
        this.isPlaying = false;
        this.emptyCount = 0;
        this.emptyThreshold = 50; // Wait for ~50 empty frames before declaring done (~250ms at 24kHz)
        this.lastSample = 0;
        this.releaseSamples = 0;
        this.releaseSamplesTotal = 32; // ~1.3ms de-click ramp on underrun

        this.levelFrameCount = 0;
        this.levelInterval = 3; // ~60 updates/sec at 24kHz with 128-sample render quantum

        this.port.onmessage = (event) => {
            if (event.data.type === 'audio') {
                // Received Int16 audio data, convert to Float32
                const int16Array = event.data.data;
                const float32Array = new Float32Array(int16Array.length);
                for (let i = 0; i < int16Array.length; i++) {
                    float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
                }
                this.chunkQueue.push(float32Array);
                this.queuedSamples += float32Array.length;
                this.isPlaying = true;
                this.emptyCount = 0; // Reset empty counter when new audio arrives
            } else if (event.data.type === 'clear') {
                this.chunkQueue = [];
                this.currentChunk = null;
                this.currentChunkIndex = 0;
                this.queuedSamples = 0;
                this.isPlaying = false;
                this.emptyCount = 0;
                this.emptyThreshold = 50;
                this.lastSample = 0;
                this.releaseSamples = 0;
                this.port.postMessage({ type: 'level', value: 0 });
            } else if (event.data.type === 'stop') {
                // Explicitly stop - don't wait for empty threshold
                this.emptyThreshold = 0;
            }
        };
    }

    readQueuedSample() {
        while (this.currentChunk && this.currentChunkIndex >= this.currentChunk.length) {
            this.currentChunk = null;
            this.currentChunkIndex = 0;
        }

        if (!this.currentChunk) {
            if (this.chunkQueue.length === 0) {
                return null;
            }
            this.currentChunk = this.chunkQueue.shift();
            this.currentChunkIndex = 0;
        }

        const sample = this.currentChunk[this.currentChunkIndex++];
        this.queuedSamples--;
        if (this.queuedSamples < 0) this.queuedSamples = 0;
        this.lastSample = sample;
        return sample;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (output && output[0]) {
            const channelData = output[0];
            let sumSquares = 0;

            for (let i = 0; i < channelData.length; i++) {
                const next = this.readQueuedSample();
                if (next !== null) {
                    channelData[i] = next;
                    this.releaseSamples = 0;
                } else {
                    if (this.releaseSamples === 0 && Math.abs(this.lastSample) > 1e-6) {
                        this.releaseSamples = this.releaseSamplesTotal;
                    }

                    if (this.releaseSamples > 0) {
                        channelData[i] = this.lastSample * (this.releaseSamples / this.releaseSamplesTotal);
                        this.releaseSamples--;
                        if (this.releaseSamples === 0) {
                            this.lastSample = 0;
                        }
                    } else {
                        channelData[i] = 0; // Silence on underrun
                    }
                }
                sumSquares += channelData[i] * channelData[i];
            }

            // Track empty frames to detect actual end of playback
            if (this.isPlaying && this.queuedSamples <= 0 && this.chunkQueue.length === 0) {
                this.emptyCount++;
                // Only notify done after sustained silence (to handle streaming gaps)
                if (this.emptyCount >= this.emptyThreshold) {
                    this.isPlaying = false;
                    this.emptyCount = 0;
                    this.emptyThreshold = 50; // Reset threshold
                    this.releaseSamples = 0;
                    this.lastSample = 0;
                    this.port.postMessage({ type: 'level', value: 0 });
                    this.port.postMessage({ type: 'playbackDone' });
                }
            } else {
                this.emptyCount = 0;
            }

            // Send RMS playback level at throttled interval
            this.levelFrameCount++;
            if (this.levelFrameCount >= this.levelInterval) {
                const rms = Math.sqrt(sumSquares / channelData.length);
                // Boost a bit for visual responsiveness while keeping in range
                const level = Math.min(1, rms * 3.5);
                this.port.postMessage({ type: 'level', value: level });
                this.levelFrameCount = 0;
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('playback-processor', PlaybackProcessor);
