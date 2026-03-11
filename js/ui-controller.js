import { formatTimestamp, generateId } from './utils.js';
import { CONFIG } from './config.js';
import { WaveVisualizer } from './wave-visualizer.js';

/**
 * Manages UI state and user interactions
 */
export class UIController {
    constructor() {
        // DOM Elements
        this.elements = {
            setupSection: document.getElementById('setupSection'),
            chatSection: document.getElementById('chatSection'),
            chatShell: document.getElementById('chatShell'),
            conversationPanel: document.getElementById('conversationPanel'),
            panelToggleBtn: document.getElementById('panelToggleBtn'),
            panelPeekBtn: document.getElementById('panelPeekBtn'),
            waveStyleBtn: document.getElementById('waveStyleBtn'),
            waveFullscreenBtn: document.getElementById('waveFullscreenBtn'),
            waveStage: document.getElementById('waveStage'),
            aiWaveCanvas: document.getElementById('aiWaveCanvas'),
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
        this.isAiSpeaking = false;
        this.currentUserMessageId = null;
        this.currentAiMessageId = null;

        this.panelExpanded = true;
        this.waveStyle = this.loadWaveStyle();
        this.waveVisualizer = null;

        // Event callbacks
        this.onConnect = null;
        this.onStartRecording = null;
        this.onStopRecording = null;
        this.onNewChat = null;

        // Bind event handlers
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleWindowBlur = this.handleWindowBlur.bind(this);
        this.handleFullscreenChange = this.handleFullscreenChange.bind(this);

        this.initializeEventListeners();
        this.applyPanelState();
        this.updateWaveStyleButton();
        this.updateWaveFullscreenButton();
        this.updateWaveStatus();
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

        // Panel controls
        this.elements.panelToggleBtn?.addEventListener('click', () => {
            this.togglePanelExpanded();
        });

        this.elements.panelPeekBtn?.addEventListener('click', () => {
            if (!this.panelExpanded) {
                this.panelExpanded = true;
                this.applyPanelState();
            }
        });

        this.elements.waveStyleBtn?.addEventListener('click', () => {
            this.toggleWaveStyle();
        });
        this.elements.waveFullscreenBtn?.addEventListener('click', () => {
            this.toggleWaveFullscreen();
        });

        // Keyboard events for push-to-talk
        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
        document.addEventListener('fullscreenchange', this.handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);

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
        if (!this.isAiSpeaking) {
            this.updateWaveStatus();
        }
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

        if (status === 'disconnected' || status === 'error') {
            this.setAiSpeaking(false);
            this.setAiWaveLevel(0);
        }
    }

    /**
     * Show the chat interface
     */
    showChatInterface() {
        this.elements.setupSection.classList.add('hidden');
        this.elements.chatSection.classList.add('active');
        this.elements.footer.classList.add('active');

        if (!this.waveVisualizer && this.elements.aiWaveCanvas) {
            this.waveVisualizer = new WaveVisualizer(this.elements.aiWaveCanvas);
            this.waveVisualizer.setStyle(this.waveStyle);
            this.waveVisualizer.start();
        }

        this.updateWaveStyleButton();
        this.updateWaveFullscreenButton();

        this.panelExpanded = true;
        this.applyPanelState();
        this.updateWaveStatus();
    }

    /**
     * Enable push-to-talk
     */
    enablePTT() {
        this.isPttEnabled = true;
        if (!this.isAiSpeaking) {
            this.updateWaveStatus();
        }
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
        this.setAiSpeaking(false);
        this.setAiWaveLevel(0);
        this.updateWaveStatus();
    }

    /**
     * Toggle transcript panel expanded/collapsed state.
     */
    togglePanelExpanded() {
        this.panelExpanded = !this.panelExpanded;
        this.applyPanelState();
    }

    /**
     * Apply panel state to the DOM.
     */
    applyPanelState() {
        const panel = this.elements.conversationPanel;
        panel.classList.remove('dock-right', 'expanded', 'collapsed');
        panel.classList.add('dock-right');
        panel.classList.add(this.panelExpanded ? 'expanded' : 'collapsed');

        this.elements.chatShell.dataset.dock = 'right';
        this.elements.chatShell.dataset.expanded = this.panelExpanded ? 'true' : 'false';

        const panelToggleBtn = this.elements.panelToggleBtn;
        panelToggleBtn.textContent = this.panelExpanded ? 'Collapse' : 'Expand';
        panelToggleBtn.setAttribute('aria-expanded', this.panelExpanded ? 'true' : 'false');

        const peekBtn = this.elements.panelPeekBtn;
        peekBtn.setAttribute('aria-expanded', this.panelExpanded ? 'true' : 'false');
        const isChatVisible = this.elements.chatSection.classList.contains('active');
        peekBtn.classList.toggle('visible', isChatVisible && !this.panelExpanded);

        // Collapse/expand changes the canvas width; force a resize pass.
        requestAnimationFrame(() => {
            this.waveVisualizer?.handleResize();
        });
    }

    /**
     * Update wave speaking state.
     * @param {boolean} isSpeaking
     */
    setAiSpeaking(isSpeaking) {
        this.isAiSpeaking = Boolean(isSpeaking);
        this.elements.waveStage.classList.toggle('speaking', this.isAiSpeaking);
        this.waveVisualizer?.setSpeaking(this.isAiSpeaking);
        this.updateWaveStatus();
    }

    /**
     * @param {number} level
     */
    setAiWaveLevel(level) {
        this.waveVisualizer?.setLevel(level);
    }

    /**
     * @returns {'ios' | 'ios9'}
     */
    loadWaveStyle() {
        const stored = window.localStorage.getItem('waveStyle');
        return stored === 'ios' ? 'ios' : 'ios9';
    }

    toggleWaveStyle() {
        this.setWaveStyle(this.waveStyle === 'ios9' ? 'ios' : 'ios9');
    }

    /**
     * @param {'ios' | 'ios9'} style
     */
    setWaveStyle(style) {
        this.waveStyle = style === 'ios' ? 'ios' : 'ios9';
        window.localStorage.setItem('waveStyle', this.waveStyle);
        this.waveVisualizer?.setStyle(this.waveStyle);
        this.updateWaveStyleButton();
    }

    updateWaveStyleButton() {
        const btn = this.elements.waveStyleBtn;
        if (!btn) return;

        const isClassic = this.waveStyle === 'ios';
        btn.textContent = isClassic ? 'Wave: Classic' : 'Wave: iOS9';
        btn.setAttribute('aria-pressed', isClassic ? 'true' : 'false');
        btn.classList.toggle('visible', this.elements.chatSection.classList.contains('active'));
    }

    /**
     * Toggle fullscreen mode for the wave stage.
     */
    async toggleWaveFullscreen() {
        const stage = this.elements.waveStage;
        if (!stage) return;

        try {
            if (this.isWaveFullscreen()) {
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                }
            } else if (stage.requestFullscreen) {
                await stage.requestFullscreen();
            } else if (stage.webkitRequestFullscreen) {
                stage.webkitRequestFullscreen();
            }
        } catch (error) {
            console.error('Failed to toggle fullscreen mode:', error);
        }
    }

    /**
     * @returns {boolean}
     */
    isWaveFullscreen() {
        const stage = this.elements.waveStage;
        return document.fullscreenElement === stage || document.webkitFullscreenElement === stage;
    }

    handleFullscreenChange() {
        this.updateWaveFullscreenButton();
        this.waveVisualizer?.handleResize();
    }

    updateWaveFullscreenButton() {
        const btn = this.elements.waveFullscreenBtn;
        if (!btn) return;

        const isChatVisible = this.elements.chatSection.classList.contains('active');
        const isFullscreen = this.isWaveFullscreen();

        btn.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
        btn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
        btn.classList.toggle('visible', isChatVisible);
    }

    /**
     * Update wave status text from current app state.
     */
    updateWaveStatus() {
        // Wave status text is intentionally removed from the UI.
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
        document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
        window.removeEventListener('blur', this.handleWindowBlur);
        this.waveVisualizer?.destroy();
    }
}
