import { CONFIG } from './config.js';

/**
 * Manages WebSocket connection to OpenAI Realtime API
 */
export class WebSocketManager {
    constructor() {
        this.ws = null;
        this.voice = CONFIG.DEFAULT_VOICE;
        this.instructions = '';
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.isConnected = false;
        this.hasInFlightResponse = false;
        this.queuedResponseCount = 0;
        this.cancelRequested = false;
        this.pendingInputAudioChunks = 0;
        this.suppressAutoReconnect = false;

        // Event callbacks
        this.onConnectionChange = null;
        this.onSessionCreated = null;
        this.onAudioDelta = null;
        this.onTranscriptDelta = null;
        this.onUserTranscript = null;
        this.onError = null;
        this.onResponseDone = null;
    }

    /**
     * Connect to the WebSocket proxy server (API key is stored server-side)
     * @param {string} voice
     * @param {string} instructions - System prompt
     * @returns {Promise<void>}
     */
    connect(voice = CONFIG.DEFAULT_VOICE, instructions = '') {
        return new Promise((resolve, reject) => {
            if (this.isConnecting || this.isConnected) {
                reject(new Error('Already connected or connecting'));
                return;
            }

            this.voice = voice;
            this.instructions = instructions;
            this.isConnecting = true;
            this.onConnectionChange?.('connecting');

            // Connect to local proxy server (no API key needed - it's server-side)
            this.suppressAutoReconnect = false;
            this.ws = new WebSocket(CONFIG.WEBSOCKET_URL);

            this.ws.onopen = () => {
                this.isConnecting = false;
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.resetResponseLifecycle();
                this.onConnectionChange?.('connected');
                this.configureSession();
                resolve();
            };

            this.ws.onclose = () => {
                const wasConnected = this.isConnected;
                const shouldReconnect = wasConnected && !this.suppressAutoReconnect;
                this.isConnecting = false;
                this.isConnected = false;
                this.suppressAutoReconnect = false;
                this.resetResponseLifecycle();
                this.onConnectionChange?.('disconnected');

                // Attempt reconnection if it was a connected session
                if (shouldReconnect) {
                    this.attemptReconnect();
                }
            };

            this.ws.onerror = () => {
                this.isConnecting = false;
                this.onConnectionChange?.('error');
                this.onError?.('Connection error. Please check server status.');
                reject(new Error('WebSocket connection failed'));
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
        });
    }

    /**
     * Configure the session after connection
     */
    configureSession() {
        const sessionConfig = {
            type: 'realtime',
            output_modalities: ['audio'],
            audio: {
                input: {
                    format: {
                        type: 'audio/pcm',
                        rate: 24000,
                    },
                    transcription: {
                        model: 'gpt-4o-transcribe',
                        language: 'zh',
                        prompt: '繁體中文',
                    },
                    turn_detection: null, // Disable VAD for push-to-talk
                },
                output: {
                    format: {
                        type: 'audio/pcm',
                        rate: CONFIG.AUDIO.SAMPLE_RATE,
                    },
                    voice: this.voice,
                },
            },
        };

        const resolvedInstructions = (this.instructions || CONFIG.SYSTEM_PROMPT || '').trim();
        if (resolvedInstructions) {
            sessionConfig.instructions = resolvedInstructions;
        }

        this.send({
            type: 'session.update',
            session: sessionConfig
        });
    }

    /**
     * Handle incoming WebSocket messages
     * @param {Object} message
     */
    handleMessage(message) {
        switch (message.type) {
            case 'session.created':
            case 'session.updated':
                this.onSessionCreated?.(message.session);
                break;

            case 'response.created':
                this.hasInFlightResponse = true;
                break;

            case 'response.audio.delta':
            case 'response.output_audio.delta':
                if (message.delta) {
                    this.onAudioDelta?.(message.delta);
                }
                break;

            case 'response.audio_transcript.delta':
            case 'response.output_audio_transcript.delta':
                if (message.delta) {
                    this.onTranscriptDelta?.(message.delta, message.item_id);
                }
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    this.onUserTranscript?.(message.transcript, message.item_id);
                }
                break;

            case 'response.done':
                this.hasInFlightResponse = false;
                this.cancelRequested = false;
                this.onResponseDone?.(message.response);
                this.flushQueuedResponseIfReady();
                break;

            case 'error':
                this.handleError(message.error);
                break;

            default:
                // Ignore other message types
                break;
        }
    }

    /**
     * Handle API errors
     * @param {Object} error
     */
    handleError(error) {
        if (this.handleActiveResponseConflict(error)) {
            return;
        }

        let errorMessage = 'An error occurred';

        if (error) {
            switch (error.code) {
                case 'invalid_api_key':
                    errorMessage = 'Invalid API key. Please check and try again.';
                    break;
                case 'rate_limit_exceeded':
                    errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
                    break;
                case 'session_expired':
                    errorMessage = 'Session expired. Reconnecting...';
                    this.attemptReconnect();
                    break;
                default:
                    errorMessage = error.message || 'An unexpected error occurred';
            }
        }

        this.onError?.(errorMessage);
    }

    /**
     * Handle response-in-progress conflict from API.
     * @param {Object} error
     * @returns {boolean}
     */
    handleActiveResponseConflict(error) {
        const errorMessage = String(error?.message || '').toLowerCase();
        const errorCode = String(error?.code || '').toLowerCase();
        const isConflict = errorMessage.includes('active response in progress')
            || errorMessage.includes('conversation already has an active response')
            || errorCode === 'conversation_already_has_active_response';

        if (!isConflict) {
            return false;
        }

        this.hasInFlightResponse = true;
        this.queuedResponseCount++;
        if (this.isConnected && !this.cancelRequested) {
            this.cancelRequested = true;
            this.send({ type: 'response.cancel' });
        }

        // Suppress user-facing error for this recoverable race.
        return true;
    }

    /**
     * Send audio data to the API
     * @param {string} base64Audio
     */
    sendAudio(base64Audio) {
        if (!this.isConnected || !base64Audio) return;

        const sent = this.send({
            type: 'input_audio_buffer.append',
            audio: base64Audio
        });
        if (sent) {
            this.pendingInputAudioChunks++;
        }
    }

    /**
     * Commit the audio buffer and request a response
     * @returns {{sent: boolean, queued: boolean, reason: string}}
     */
    commitAudioAndRespond() {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return { sent: false, queued: false, reason: 'not_connected' };
        }

        if (this.pendingInputAudioChunks === 0) {
            return { sent: false, queued: false, reason: 'empty_audio' };
        }

        // Commit the audio buffer
        const commitSent = this.send({ type: 'input_audio_buffer.commit' });
        if (!commitSent) {
            return { sent: false, queued: false, reason: 'commit_send_failed' };
        }
        this.pendingInputAudioChunks = 0;

        // Queue next response until current one finishes.
        if (this.hasInFlightResponse) {
            this.queuedResponseCount++;
            return { sent: false, queued: true, reason: 'response_in_flight' };
        }

        if (this.createResponseNow()) {
            return { sent: true, queued: false, reason: 'sent' };
        }

        return { sent: false, queued: false, reason: 'send_failed' };
    }

    /**
     * Clear the input audio buffer
     */
    clearAudioBuffer() {
        if (!this.isConnected) return;

        const cleared = this.send({ type: 'input_audio_buffer.clear' });
        if (cleared) {
            this.pendingInputAudioChunks = 0;
        }
    }

    /**
     * Cancel the current response (for interruptions)
     */
    cancelResponse() {
        if (!this.isConnected || !this.hasInFlightResponse || this.cancelRequested) return;

        this.cancelRequested = true;
        this.send({ type: 'response.cancel' });
    }

    /**
     * Send a message through the WebSocket
     * @param {Object} message
     * @returns {boolean}
     */
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    /**
     * Send response.create immediately and mark response lifecycle state.
     * @returns {boolean}
     */
    createResponseNow() {
        const sent = this.send({
            type: 'response.create',
            response: {
                conversation: 'auto',
                max_output_tokens: CONFIG.RESPONSE_MAX_OUTPUT_TOKENS,
            },
        });

        if (sent) {
            this.hasInFlightResponse = true;
            this.cancelRequested = false;
        }

        return sent;
    }

    /**
     * Send queued response if prior response has completed.
     */
    flushQueuedResponseIfReady() {
        if (this.queuedResponseCount <= 0 || this.hasInFlightResponse) return;
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        if (this.createResponseNow()) {
            this.queuedResponseCount = Math.max(0, this.queuedResponseCount - 1);
        }
    }

    /**
     * Reset response state.
     */
    resetResponseLifecycle() {
        this.hasInFlightResponse = false;
        this.queuedResponseCount = 0;
        this.cancelRequested = false;
        this.pendingInputAudioChunks = 0;
    }

    /**
     * Attempt to reconnect with exponential backoff
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= CONFIG.RECONNECTION.MAX_ATTEMPTS) {
            this.onError?.('Connection lost. Max reconnection attempts reached.');
            return;
        }

        const delay = Math.min(
            CONFIG.RECONNECTION.BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            CONFIG.RECONNECTION.MAX_DELAY_MS
        );

        this.reconnectAttempts++;
        this.onConnectionChange?.('reconnecting');

        setTimeout(() => {
            if (!this.isConnected && !this.isConnecting) {
                this.connect(this.voice, this.instructions).catch(() => {
                    // Error handled in connect()
                });
            }
        }, delay);
    }

    /**
     * Disconnect from the API
     */
    disconnect() {
        this.reconnectAttempts = CONFIG.RECONNECTION.MAX_ATTEMPTS; // Prevent reconnection

        if (this.ws) {
            this.suppressAutoReconnect = true;
            this.ws.close();
            this.ws = null;
        }

        this.isConnecting = false;
        this.isConnected = false;
        this.resetResponseLifecycle();
    }

    /**
     * Reset session - disconnect and reconnect to start fresh conversation
     * @returns {Promise<void>}
     */
    async resetSession() {
        const savedVoice = this.voice;
        const savedInstructions = this.instructions;

        // Disconnect without triggering reconnect
        this.reconnectAttempts = CONFIG.RECONNECTION.MAX_ATTEMPTS;
        if (this.ws) {
            this.suppressAutoReconnect = true;
            this.ws.close();
            this.ws = null;
        }
        this.isConnecting = false;
        this.isConnected = false;
        this.resetResponseLifecycle();

        // Reset reconnect attempts and reconnect
        this.reconnectAttempts = 0;
        await this.connect(savedVoice, savedInstructions);
    }
}
