# Real-Time Voice Chat

A push-to-talk web client for OpenAI's Realtime API built with vanilla JavaScript, AudioWorklets, and WebSockets. Hold the spacebar to stream microphone audio, see transcripts in real time, and optionally persist AI speech to disk for debugging.

## Features

- Push-to-talk voice chat with OpenAI's Realtime API
- Real-time transcription for both user and AI speech
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
3. **Watch transcripts** update in real time for both your speech (Whisper) and the AI response.
4. **New Chat** at any time to clear the transcript and reset the session.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space (hold) | Capture microphone audio |
| Space (release) | Send audio and request a reply |

## Building Executables

Build standalone executables that users can run without Node.js.

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

## Multi-turn Memory

The app maintains conversation history automatically. Once Whisper completes a user transcript, a `conversation.item.create` is sent with `input_text`. Subsequent responses reference the full history via `conversation: 'auto'`.

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
