/**
 * AudioWorklet processor for capturing microphone input
 * Runs on a dedicated audio thread for non-blocking processing
 */
class CaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2400; // ~100ms at 24kHz
        // Pre-allocated ring buffer to avoid GC pressure on the audio thread
        this.ringBuffer = new Int16Array(this.bufferSize);
        this.writeIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input[0]) {
            const channelData = input[0];

            // Convert Float32 to Int16 PCM and write into ring buffer
            for (let i = 0; i < channelData.length; i++) {
                const s = Math.max(-1, Math.min(1, channelData[i]));
                this.ringBuffer[this.writeIndex] = s < 0 ? s * 0x8000 : s * 0x7fff;
                this.writeIndex++;

                // Send buffer when full
                if (this.writeIndex >= this.bufferSize) {
                    // Copy and send — the worklet keeps ownership of ringBuffer
                    const int16Array = new Int16Array(this.ringBuffer);
                    this.port.postMessage({
                        type: 'audio',
                        data: int16Array
                    });
                    this.writeIndex = 0;
                }
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('capture-processor', CaptureProcessor);
