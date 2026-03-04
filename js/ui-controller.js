import { formatTimestamp, generateId } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Manages UI state and user interactions
 */
export class UIController {
    constructor() {
        // DOM Elements
        this.elements = {
            setupSection: document.getElementById('setupSection'),
            chatSection: document.getElementById('chatSection'),
            footer: document.getElementById('footer'),
            voiceSelect: document.getElementById('voiceSelect'),
            connectBtn: document.getElementById('connectBtn'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            transcriptMessages: document.getElementById('transcriptMessages'),
            transcriptContainer: document.getElementById('transcriptContainer'),
            recordingIndicator: document.getElementById('recordingIndicator'),
            pttKey: document.querySelector('.ptt-key'),
            errorToast: document.getElementById('errorToast'),
            errorMessage: document.getElementById('errorMessage'),
            errorClose: document.getElementById('errorClose'),
            newChatBtn: document.getElementById('newChatBtn'),
        };

        // State
        this.isRecording = false;
        this.isPttEnabled = false;
        this.currentUserMessageId = null;
        this.currentAiMessageId = null;

        // Event callbacks
        this.onConnect = null;
        this.onStartRecording = null;
        this.onStopRecording = null;
        this.onNewChat = null;

        // Bind event handlers
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleWindowBlur = this.handleWindowBlur.bind(this);

        this.initializeEventListeners();
    }

    /**
     * Set up event listeners
     */
    initializeEventListeners() {
        // Connect button
        this.elements.connectBtn.addEventListener('click', () => {
            const voice = this.elements.voiceSelect.value;
            if (this.onConnect) {
                this.onConnect(voice, CONFIG.SYSTEM_PROMPT);
            }
        });

        // Error toast close button
        this.elements.errorClose.addEventListener('click', () => {
            this.hideError();
        });

        // New chat button
        this.elements.newChatBtn.addEventListener('click', () => {
            this.onNewChat?.();
        });

        // Keyboard events for push-to-talk
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);

        // Handle window blur (stop recording if user tabs away)
        window.addEventListener('blur', this.handleWindowBlur);
    }

    /**
     * Handle keydown for push-to-talk
     * @param {KeyboardEvent} e
     */
    handleKeyDown(e) {
        if (!this.isPttEnabled) return;

        // Only trigger on spacebar, ignore if typing in input
        if (e.code === 'Space' && !this.isInputFocused()) {
            e.preventDefault(); // Prevent scrolling

            if (!this.isRecording) {
                this.isRecording = true;
                this.updateRecordingState(true);
                this.onStartRecording?.();
            }
        }
    }

    /**
     * Handle keyup for push-to-talk
     * @param {KeyboardEvent} e
     */
    handleKeyUp(e) {
        if (!this.isPttEnabled) return;

        if (e.code === 'Space' && this.isRecording) {
            this.isRecording = false;
            this.updateRecordingState(false);
            this.onStopRecording?.();
        }
    }

    /**
     * Handle window blur - stop recording
     */
    handleWindowBlur() {
        if (this.isRecording) {
            this.isRecording = false;
            this.updateRecordingState(false);
            this.onStopRecording?.();
        }
    }

    /**
     * Check if user is typing in an input field
     * @returns {boolean}
     */
    isInputFocused() {
        const activeElement = document.activeElement;
        return activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
        );
    }

    /**
     * Update recording visual state
     * @param {boolean} isRecording
     */
    updateRecordingState(isRecording) {
        this.elements.recordingIndicator.classList.toggle('active', isRecording);
        this.elements.pttKey.classList.toggle('pressed', isRecording);
    }

    /**
     * Update connection status display
     * @param {string} status - 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
     */
    updateConnectionStatus(status) {
        const { statusIndicator, statusText, connectBtn } = this.elements;

        statusIndicator.className = 'status-indicator';

        switch (status) {
            case 'connected':
                statusIndicator.classList.add('connected');
                statusText.textContent = 'Connected';
                connectBtn.disabled = true;
                connectBtn.textContent = 'Connected';
                break;
            case 'connecting':
                statusIndicator.classList.add('connecting');
                statusText.textContent = 'Connecting...';
                connectBtn.disabled = true;
                connectBtn.textContent = 'Connecting...';
                break;
            case 'reconnecting':
                statusIndicator.classList.add('connecting');
                statusText.textContent = 'Reconnecting...';
                break;
            case 'error':
                statusText.textContent = 'Error';
                connectBtn.disabled = false;
                connectBtn.textContent = 'Retry';
                break;
            default:
                statusText.textContent = 'Disconnected';
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect';
        }
    }

    /**
     * Show the chat interface
     */
    showChatInterface() {
        this.elements.setupSection.classList.add('hidden');
        this.elements.chatSection.classList.add('active');
        this.elements.footer.classList.add('active');
    }

    /**
     * Enable push-to-talk
     */
    enablePTT() {
        this.isPttEnabled = true;
    }

    /**
     * Disable push-to-talk
     */
    disablePTT() {
        this.isPttEnabled = false;
        if (this.isRecording) {
            this.isRecording = false;
            this.updateRecordingState(false);
        }
    }

    /**
     * Start a user message placeholder (shown while waiting for transcription)
     * @returns {string} Message ID
     */
    startUserMessage() {
        const id = generateId();
        const messageEl = this.createMessageElement(id, 'user', '...', true);
        this.elements.transcriptMessages.appendChild(messageEl);
        this.currentUserMessageId = id;
        this.scrollToBottom();
        return id;
    }

    /**
     * Update the current user message with transcription
     * @param {string} text
     */
    updateUserMessage(text) {
        if (!this.currentUserMessageId) return;

        const bubble = document.querySelector(`#msg-${this.currentUserMessageId} .message-bubble`);
        if (bubble) {
            bubble.textContent = text;
            bubble.classList.remove('streaming');
        }
        this.currentUserMessageId = null;
    }

    /**
     * Add a user message to the transcript (immediate, no placeholder)
     * @param {string} text
     * @returns {string} Message ID
     */
    addUserMessage(text) {
        // If we have a pending user message, update it instead
        if (this.currentUserMessageId) {
            this.updateUserMessage(text);
            return this.currentUserMessageId;
        }

        const id = generateId();
        const messageEl = this.createMessageElement(id, 'user', text);
        this.elements.transcriptMessages.appendChild(messageEl);
        this.scrollToBottom();
        return id;
    }

    /**
     * Start a new AI message (for streaming)
     * @returns {string} Message ID
     */
    startAiMessage() {
        const id = generateId();
        const messageEl = this.createMessageElement(id, 'ai', '', true);
        this.elements.transcriptMessages.appendChild(messageEl);
        this.currentAiMessageId = id;
        this.scrollToBottom();
        return id;
    }

    /**
     * Append text to the current AI message
     * @param {string} text
     */
    appendToAiMessage(text) {
        if (!this.currentAiMessageId) return;

        const bubble = document.querySelector(`#msg-${this.currentAiMessageId} .message-bubble`);
        if (bubble) {
            bubble.textContent += text;
            this.scrollToBottom();
        }
    }

    /**
     * Set the complete text for the current AI message (replaces placeholder)
     * @param {string} text
     */
    setAiMessage(text) {
        if (!this.currentAiMessageId) return;

        const bubble = document.querySelector(`#msg-${this.currentAiMessageId} .message-bubble`);
        if (bubble) {
            bubble.textContent = text;
            this.scrollToBottom();
        }
    }

    /**
     * Finish the current AI message
     */
    finishAiMessage() {
        if (!this.currentAiMessageId) return;

        const bubble = document.querySelector(`#msg-${this.currentAiMessageId} .message-bubble`);
        if (bubble) {
            bubble.classList.remove('streaming');
        }
        this.currentAiMessageId = null;
    }

    /**
     * Create a message element
     * @param {string} id
     * @param {string} type - 'user' | 'ai'
     * @param {string} text
     * @param {boolean} streaming
     * @returns {HTMLElement}
     */
    createMessageElement(id, type, text, streaming = false) {
        const message = document.createElement('div');
        message.className = `message ${type}`;
        message.id = `msg-${id}`;

        const bubble = document.createElement('div');
        bubble.className = `message-bubble${streaming ? ' streaming' : ''}`;
        bubble.textContent = text;

        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = formatTimestamp(new Date());

        message.appendChild(bubble);
        message.appendChild(timestamp);

        return message;
    }

    /**
     * Scroll transcript to bottom
     */
    scrollToBottom() {
        const container = this.elements.transcriptContainer;
        container.scrollTop = container.scrollHeight;
    }

    /**
     * Clear transcript and reset message state
     */
    clearTranscript() {
        this.elements.transcriptMessages.innerHTML = '';
        this.currentUserMessageId = null;
        this.currentAiMessageId = null;
    }

    /**
     * Show error message
     * @param {string} message
     */
    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorToast.classList.add('visible');

        // Auto-hide after 5 seconds
        setTimeout(() => this.hideError(), 5000);
    }

    /**
     * Hide error message
     */
    hideError() {
        this.elements.errorToast.classList.remove('visible');
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('blur', this.handleWindowBlur);
    }
}
