/**
 * Convert Float32Array to Int16Array (PCM16)
 * @param {Float32Array} float32Array
 * @returns {Int16Array}
 */
export function floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

/**
 * Convert Int16Array to Float32Array
 * @param {Int16Array} int16Array
 * @returns {Float32Array}
 */
export function int16ToFloat32(int16Array) {
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
    }
    return float32Array;
}

/**
 * Encode Int16Array to base64 string
 * @param {Int16Array} int16Array
 * @returns {string}
 */
export function int16ArrayToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decode base64 string to Int16Array
 * @param {string} base64
 * @returns {Int16Array}
 */
export function base64ToInt16Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
}

/**
 * Format timestamp for message display
 * @param {Date} date
 * @returns {string}
 */
export function formatTimestamp(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generate a unique ID
 * @returns {string}
 */
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
