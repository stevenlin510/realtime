/**
 * AudioWorklet processor for capturing microphone input
 * Runs on a dedicated audio thread for non-blocking processing
 */
class CaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = [];
        this.bufferSize = 2400; // ~100ms at 24kHz
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input[0]) {
            const channelData = input[0];

            // Convert Float32 to Int16 PCM
            for (let i = 0; i < channelData.length; i++) {
                const s = Math.max(-1, Math.min(1, channelData[i]));
                const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
                this.buffer.push(int16);
            }

            // Send buffer when we have enough samples
            if (this.buffer.length >= this.bufferSize) {
                const int16Array = new Int16Array(this.buffer.splice(0, this.bufferSize));
                this.port.postMessage({
                    type: 'audio',
                    data: int16Array
                });
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('capture-processor', CaptureProcessor);
