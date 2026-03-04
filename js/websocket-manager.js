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
        this.isResponseActive = false;

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
            this.ws = new WebSocket(CONFIG.WEBSOCKET_URL);

            this.ws.onopen = () => {
                this.isConnecting = false;
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.onConnectionChange?.('connected');
                this.configureSession();
                resolve();
            };

            this.ws.onclose = () => {
                const wasConnected = this.isConnected;
                this.isConnecting = false;
                this.isConnected = false;
                this.onConnectionChange?.('disconnected');

                // Attempt reconnection if it was a connected session
                if (wasConnected) {
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
            modalities: ['text', 'audio'],
            voice: this.voice,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
                model: 'gpt-4o-transcribe',
                language: 'zh',
                prompt: '繁體中文'
            },
            turn_detection: null, // Disable VAD for push-to-talk
        };

        // Add instructions (system prompt) if provided
        if (this.instructions) {
            sessionConfig.instructions = this.instructions;
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
                this.isResponseActive = true;
                break;

            case 'response.audio.delta':
                if (message.delta) {
                    this.onAudioDelta?.(message.delta);
                }
                break;

            case 'response.audio_transcript.delta':
                if (message.delta) {
                    this.onTranscriptDelta?.(message.delta, message.item_id);
                }
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    this.onUserTranscript?.(message.transcript, message.item_id);
                    this.addConversationMessage('user', message.transcript);
                }
                break;

            case 'response.done':
                this.isResponseActive = false;
                this.onResponseDone?.(message.response);
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
     * Send a conversation item to the Realtime API
     * @param {'user'|'assistant'} role
     * @param {string} text
     */
    addConversationMessage(role, text) {
        if (role !== 'user') return;
        const trimmed = text?.trim();
        if (!trimmed) return;

        this.send({
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: trimmed,
                    },
                ],
            },
        });
    }

    /**
     * Send audio data to the API
     * @param {string} base64Audio
     */
    sendAudio(base64Audio) {
        if (!this.isConnected) return;

        this.send({
            type: 'input_audio_buffer.append',
            audio: base64Audio
        });
    }

    /**
     * Commit the audio buffer and request a response
     */
    commitAudioAndRespond() {
        if (!this.isConnected) return;

        // Commit the audio buffer
        this.send({ type: 'input_audio_buffer.commit' });

        // Request a response referencing the existing conversation
        this.send({
            type: 'response.create',
            response: {
                conversation: 'auto',
            },
        });
    }

    /**
     * Clear the input audio buffer
     */
    clearAudioBuffer() {
        if (!this.isConnected) return;

        this.send({ type: 'input_audio_buffer.clear' });
    }

    /**
     * Cancel the current response (for interruptions)
     */
    cancelResponse() {
        if (!this.isConnected || !this.isResponseActive) return;

        this.isResponseActive = false;
        this.send({ type: 'response.cancel' });
    }

    /**
     * Send a message through the WebSocket
     * @param {Object} message
     */
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
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
            this.ws.close();
            this.ws = null;
        }

        this.isConnecting = false;
        this.isConnected = false;
        this.isResponseActive = false;
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
            this.ws.close();
            this.ws = null;
        }
        this.isConnecting = false;
        this.isConnected = false;
        this.isResponseActive = false;

        // Reset reconnect attempts and reconnect
        this.reconnectAttempts = 0;
        await this.connect(savedVoice, savedInstructions);
    }
}
