import SiriWave from '../node_modules/siriwave/dist/siriwave.esm.js';

const VISUALIZER = {
    idleAmplitude: 0.08,
    idleAmplitudeReduced: 0.04,
    speakingGain: 1.2,
    idleGain: 0.16,
    idleDecay: 0.94,
    speakingSmoothing: 0.32,
    idleSmoothing: 0.1,
    idleSpeed: 0.08,
    idleSpeedReduced: 0.05,
    speakingSpeedBase: 0.2,
    speakingSpeedBoost: 0.22,
    lerpSpeed: 0.12,
    lerpSpeedReduced: 0.08,
};

/**
 * SiriWave visualizer adapter with style switching support (ios9/classic ios).
 * Preserves the legacy component API used by UIController.
 */
export class WaveVisualizer {
    /**
     * @param {HTMLElement} container
     */
    constructor(container) {
        this.container = container;
        this.siriWave = null;
        this.animationFrame = null;
        this.resizeFrame = null;
        this.running = false;

        this.targetLevel = 0;
        this.smoothedLevel = 0;
        this.isSpeaking = false;
        this.waveStyle = 'ios9';

        this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.prefersReducedMotion = this.reducedMotionQuery.matches;

        this.animate = this.animate.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.handleMotionPreference = this.handleMotionPreference.bind(this);
    }

    start() {
        if (this.running) return;
        this.running = true;

        this.disposeWaveInstance();
        this.createWaveInstance();
        this.siriWave?.start();
        this.syncSpeed();

        window.addEventListener('resize', this.handleResize);
        this.reducedMotionQuery.addEventListener?.('change', this.handleMotionPreference);

        this.animationFrame = requestAnimationFrame(this.animate);
    }

    stop() {
        this.running = false;

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this.resizeFrame) {
            cancelAnimationFrame(this.resizeFrame);
            this.resizeFrame = null;
        }

        this.siriWave?.stop();
        this.siriWave?.setAmplitude(this.getIdleAmplitude());
    }

    /**
     * @param {number} level
     */
    setLevel(level) {
        const safeLevel = Number.isFinite(level) ? level : 0;
        this.targetLevel = Math.max(0, Math.min(1, safeLevel));
    }

    /**
     * @param {boolean} isSpeaking
     */
    setSpeaking(isSpeaking) {
        this.isSpeaking = Boolean(isSpeaking);
        this.syncSpeed();
    }

    /**
     * @param {'ios' | 'ios9'} style
     */
    setStyle(style) {
        const nextStyle = style === 'ios' ? 'ios' : 'ios9';
        if (nextStyle === this.waveStyle) return;
        this.waveStyle = nextStyle;
        if (this.siriWave) {
            this.recreateWaveInstance();
        }
    }

    destroy() {
        this.stop();
        window.removeEventListener('resize', this.handleResize);
        this.reducedMotionQuery.removeEventListener?.('change', this.handleMotionPreference);
        this.disposeWaveInstance();
    }

    /**
     * @param {MediaQueryListEvent} event
     */
    handleMotionPreference(event) {
        this.prefersReducedMotion = event.matches;
        this.recreateWaveInstance();
    }

    handleResize() {
        if (this.resizeFrame) {
            cancelAnimationFrame(this.resizeFrame);
        }

        this.resizeFrame = requestAnimationFrame(() => {
            this.resizeFrame = null;
            this.recreateWaveInstance();
        });
    }

    animate() {
        if (!this.running) return;

        const smoothing = this.isSpeaking ? VISUALIZER.speakingSmoothing : VISUALIZER.idleSmoothing;
        this.smoothedLevel += (this.targetLevel - this.smoothedLevel) * smoothing;

        if (!this.isSpeaking) {
            this.targetLevel *= VISUALIZER.idleDecay;
        }

        const amplitude = this.computeAmplitude();
        this.siriWave?.setAmplitude(amplitude);
        this.syncSpeed();

        this.animationFrame = requestAnimationFrame(this.animate);
    }

    computeAmplitude() {
        const base = this.getIdleAmplitude();
        const gain = this.isSpeaking ? VISUALIZER.speakingGain : VISUALIZER.idleGain;
        const value = base + this.smoothedLevel * gain;
        return Math.max(base, Math.min(1, value));
    }

    getIdleAmplitude() {
        return this.prefersReducedMotion ? VISUALIZER.idleAmplitudeReduced : VISUALIZER.idleAmplitude;
    }

    getTargetSpeed() {
        if (!this.isSpeaking) {
            return this.prefersReducedMotion ? VISUALIZER.idleSpeedReduced : VISUALIZER.idleSpeed;
        }
        return VISUALIZER.speakingSpeedBase + this.smoothedLevel * VISUALIZER.speakingSpeedBoost;
    }

    syncSpeed() {
        this.siriWave?.setSpeed(this.getTargetSpeed());
    }

    createWaveInstance() {
        if (!this.container) return;

        const rect = this.container.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        this.siriWave = new SiriWave({
            container: this.container,
            style: this.waveStyle,
            width,
            height,
            cover: true,
            autostart: false,
            amplitude: this.getIdleAmplitude(),
            speed: this.getTargetSpeed(),
            lerpSpeed: this.prefersReducedMotion ? VISUALIZER.lerpSpeedReduced : VISUALIZER.lerpSpeed,
            globalCompositeOperation: 'lighter',
        });
    }

    disposeWaveInstance() {
        this.siriWave?.dispose();
        this.siriWave = null;
    }

    recreateWaveInstance() {
        const shouldRun = this.running;
        this.disposeWaveInstance();
        this.createWaveInstance();
        if (shouldRun) {
            this.siriWave?.start();
        }
        this.syncSpeed();
        this.siriWave?.setAmplitude(this.computeAmplitude());
    }
}
