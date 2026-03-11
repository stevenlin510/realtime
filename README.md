# Real-Time Voice Chat

A push-to-talk web client for OpenAI's Realtime API built with vanilla JavaScript, AudioWorklets, WebSockets, and a SiriWave (iOS9 style) visualizer. Hold the spacebar to stream microphone audio, see transcripts in real time, and optionally persist AI speech to disk for debugging.

## Features

- Push-to-talk voice chat with OpenAI's Realtime API
- Real-time transcription for both user and AI speech
- SiriWave iOS9-style response waveform
- Multi-turn conversation memory
- Secure API key storage (server-side, never exposed to browser)
- Build standalone executables for macOS and Windows
- Optional embedded API key for trusted distribution

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure API Key

Copy the example environment file and add your OpenAI API key:

```bash
cp .env.example .env
```

Edit `.env`:
```
OPENAI_API_KEY=sk-your-api-key-here
PORT=8000
```

### 3. Start the Server

```bash
npm start
```

### 4. Open the App

Open [http://localhost:8000](http://localhost:8000), pick a voice, click **Connect**, and allow microphone access.

## Usage

1. **Hold Space** to start recording. The UI lights up to confirm capture started.
2. **Release Space** to stop recording, commit the audio buffer, and request a response.
   If a response is already in progress, the app cancels the active response and queues the new response until `response.done`.
3. **Watch transcripts** update in real time for both your speech (Whisper) and the AI response.
4. **New Chat** at any time to clear the transcript and reset the session.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space (hold) | Capture microphone audio |
| Space (release) | Send audio and request a reply |

## Building Executables

Build standalone executables that users can run without Node.js.

### Prerequisites (builder machine)

```bash
npm install
```

### Standard Build (users provide their own API key)

```bash
npm run build:mac    # macOS (Apple Silicon)
npm run build:win    # Windows (64-bit)
npm run build        # Both platforms
```

Users will need to:
1. Run the executable (first run creates `.env` file)
2. Edit `.env` and add their API key
3. Run again

### Install and Run Executable (recipient machine)

No Node.js install is required for end users.

#### macOS (Apple Silicon)

1. Copy `realtime-voice-chat` to a folder you can write to (for example `~/Applications/realtime-chat/`).
2. Open Terminal in that folder and run:
   ```bash
   chmod +x realtime-voice-chat
   ./realtime-voice-chat
   ```
3. On first run, the app creates `.env` in the same folder as the executable and exits.
4. Edit `.env` and set:
   ```env
   OPENAI_API_KEY=sk-your-api-key-here
   PORT=8000
   ```
5. Run `./realtime-voice-chat` again, then open [http://localhost:8000](http://localhost:8000).

#### Windows (64-bit)

1. Copy `realtime-voice-chat.exe` to a writable folder (for example `C:\realtime-chat\`).
2. Double-click `realtime-voice-chat.exe` once (or run it from PowerShell).
3. On first run, `.env` is created next to the `.exe` and the app exits.
4. Edit `.env` and set:
   ```env
   OPENAI_API_KEY=sk-your-api-key-here
   PORT=8000
   ```
5. Run `realtime-voice-chat.exe` again, then open [http://localhost:8000](http://localhost:8000).

### Embedded Build (API key baked in)

For trusted users - no setup required:

```bash
npm run build:embed:mac    # macOS with embedded key
npm run build:embed:win    # Windows with embedded key
npm run build:embed        # Both platforms
```

The API key from your `.env` is embedded into the executable. Users just run it and open http://localhost:8000.

> **Security Note:** Anyone with the executable has access to your API key. Only share with trusted people.

### Build Output

Executables are created in the `dist/` folder:

| File | Platform | Size |
|------|----------|------|
| `realtime-voice-chat` | macOS (Apple Silicon) | ~44MB |
| `realtime-voice-chat.exe` | Windows 10/11 (64-bit) | ~36MB |

## Executable Troubleshooting

- `EADDRINUSE` on startup: port `8000` is already used; change `PORT` in `.env` (example: `PORT=8011`).
- macOS says app is blocked: right-click the binary and choose **Open**, then confirm.
- Windows SmartScreen warning: click **More info** -> **Run anyway** if you trust the file.

## Sharing Options

### Option 1: Tunnel (ngrok/cloudflared)

Share your local instance temporarily:

```bash
npm start
ngrok http 8000  # or: cloudflared tunnel --url http://localhost:8000
```

Share the generated URL. Note: users consume YOUR API credits.

### Option 2: Executable Distribution

Send the built executable to users. With embedded build, they just run it. With standard build, they add their own API key.

## Configuration

Edit `js/config.js` to customize:

- `VOICES` / `DEFAULT_VOICE`: Voice options in the UI dropdown
- `SYSTEM_PROMPT`: Instructions injected on session creation
- `RECONNECTION`: Backoff policy for automatic reconnects
- `SESSION_TIMEOUT_MS`: Safety timeout for long-lived tabs

## Wave Visualizer Tuning

Wave behavior is controlled in `js/wave-visualizer.js`.

### 1. Core tuning constants

Edit the `VISUALIZER` object at the top of `js/wave-visualizer.js`:

| Key | What it controls |
|-----|------------------|
| `idleAmplitude` / `idleAmplitudeReduced` | Base wave height when AI is not speaking |
| `speakingGain` | How strongly audio level increases amplitude while speaking |
| `idleGain` | How much movement remains while idle |
| `idleDecay` | How fast level falls back after speech ends (`<1` decays each frame) |
| `speakingSmoothing` / `idleSmoothing` | Responsiveness to level changes (higher = faster reaction) |
| `idleSpeed` / `idleSpeedReduced` | Animation speed when idle |
| `speakingSpeedBase` | Base animation speed while speaking |
| `speakingSpeedBoost` | Extra speed added from live level |
| `lerpSpeed` / `lerpSpeedReduced` | SiriWave internal interpolation smoothness |

### 2. SiriWave style and render options

Inside `createWaveInstance()` in `js/wave-visualizer.js`, you can tune SiriWave options:

- `style`: `'ios9'` or `'ios'` (classic)
- `amplitude`: initial amplitude at instance creation
- `speed`: initial speed at instance creation
- `globalCompositeOperation`: blend mode for wave overlap (`'lighter'` by default)

### 3. Switch iOS9/classic style

- In UI: use the top-right wave button (`Wave: iOS9` / `Wave: Classic`).
- In code: call `setStyle('ios9')` or `setStyle('ios')` on `WaveVisualizer`.
- The selected style is saved in browser `localStorage` key `waveStyle`.

### 4. Quick examples

Make waves bigger when AI speaks:

```js
const VISUALIZER = {
  // ...
  speakingGain: 1.2,
  idleAmplitude: 0.1,
};
```

Make animation calmer and smoother:

```js
const VISUALIZER = {
  // ...
  speakingSmoothing: 0.2,
  speakingSpeedBase: 0.16,
  speakingSpeedBoost: 0.14,
};
```

## Multi-turn Memory

The app maintains conversation history automatically through Realtime conversation items created from audio input and model responses. Subsequent responses reference full history via `conversation: 'auto'`.

Use **New Chat** to clear history and start fresh.

## Debug Audio

Every AI response is saved to `tmp.wav` for inspection. The file is overwritten each turn. To disable, remove the `saveDebugAudio()` call in `js/app.js`.

## File Structure

```
realtime/
├── index.html                  # Main UI
├── styles.css                  # Layout and theme
├── server.js                   # Node server + WebSocket proxy
├── build.js                    # Build script for embedded key
├── package.json                # Scripts and dependencies
├── .env                        # API key (create from .env.example)
├── .env.example                # Environment template
├── .gitignore                  # Excludes .env, node_modules, dist
├── js/
│   ├── app.js                  # App orchestrator
│   ├── audio-capture.js        # Microphone capture pipeline
│   ├── audio-playback.js       # Buffered playback pipeline
│   ├── config.js               # Runtime configuration
│   ├── ui-controller.js        # UI + push-to-talk state
│   ├── utils.js                # Shared helpers
│   ├── wave-visualizer.js      # SiriWave iOS9 visualizer adapter
│   └── websocket-manager.js    # WebSocket client
├── worklets/
│   ├── capture-processor.js    # AudioWorklet for input
│   └── playback-processor.js   # AudioWorklet for output
└── dist/                       # Built executables (generated)
```

## Security

- API key is stored in `.env` on the server, never sent to the browser
- WebSocket proxy handles OpenAI authentication server-side
- `.env` is gitignored to prevent accidental commits

## Requirements

- Node.js 18+
- Modern browser with AudioWorklet support (Chrome, Edge, Safari, Firefox)
- OpenAI API key with Realtime API access
