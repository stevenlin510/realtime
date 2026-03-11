#!/usr/bin/env node
/**
 * Node.js server with WebSocket proxy to OpenAI Realtime API.
 * The API key is stored server-side and never exposed to the browser.
 *
 * Usage:
 *   1. Create a .env file in the same folder with: OPENAI_API_KEY=sk-your-key
 *   2. Run the executable or: npm start
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Detect if running as packaged executable
const isPkg = typeof process.pkg !== 'undefined';

// For packaged app: look for .env in same directory as the executable
// For development: look for .env next to server.js
const appDir = isPkg ? path.dirname(process.execPath) : __dirname;
const envPath = path.resolve(appDir, '.env');

// Load environment variables from .env file
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=');
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        }
    }
} else if (isPkg) {
    console.log('');
    console.log('='.repeat(60));
    console.log('First time setup: Creating .env file...');
    console.log('='.repeat(60));

    // Copy .env.example to current directory
    const exampleContent = `# OpenAI API Key (required)
# Get your key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your-api-key-here

# Server port (optional, default: 8000)
PORT=8000
`;
    fs.writeFileSync(envPath, exampleContent);
    console.log(`Created ${envPath}`);
    console.log('Please edit this file and add your OpenAI API key, then run again.');
    console.log('='.repeat(60));
    process.exit(0);
}

const PORT = Number(process.env.PORT) || 8000;
const AUDIO_FILE = path.resolve(appDir, process.env.AUDIO_FILE || 'tmp.wav');

// Static files are bundled in __dirname (snapshot filesystem for pkg)
const PUBLIC_DIR = path.resolve(__dirname);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5';

// Validate API key on startup
if (!OPENAI_API_KEY || OPENAI_API_KEY === 'sk-your-api-key-here') {
    console.error('');
    console.error('ERROR: OPENAI_API_KEY not configured!');
    console.error(`Please edit ${envPath} and add your API key.`);
    console.error('');
    process.exit(1);
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.webm': 'video/webm',
    '.txt': 'text/plain; charset=utf-8',
};

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function serveStaticFile(filePath, res) {
    fs.stat(filePath, (statErr, stats) => {
        if (statErr || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
}

function handleSaveAudio(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFile(AUDIO_FILE, buffer, (writeErr) => {
            if (writeErr) {
                console.error('Failed to save audio:', writeErr);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false }));
                return;
            }

            console.log(`Saved audio to ${AUDIO_FILE} (${buffer.length} bytes)`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    });
}

// HTTP server for static files and /save-audio
const server = http.createServer((req, res) => {
    if (!req.url) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
    }

    if (req.url.startsWith('/save-audio')) {
        handleSaveAudio(req, res);
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    if (pathname === '/') {
        pathname = '/index.html';
    }

    const sanitizedPathname = pathname.replace(/\\/g, '/');
    const normalizedPath = path.posix.normalize(sanitizedPathname);
    const withoutLeadingTraversal = normalizedPath.replace(/^(\.\.\/)+/, '');
    const relativePath = withoutLeadingTraversal.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, relativePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    serveStaticFile(filePath, res);
});

// WebSocket server for proxying to OpenAI Realtime API
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (clientWs, req) => {
    console.log('Client connected, establishing OpenAI connection...');

    // Connect to OpenAI with the server-side API key
    const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
    });

    let openaiConnected = false;
    const messageQueue = [];

    openaiWs.on('open', () => {
        console.log('Connected to OpenAI Realtime API');
        openaiConnected = true;

        // Send any queued messages
        for (const msg of messageQueue) {
            openaiWs.send(msg);
        }
        messageQueue.length = 0;
    });

    openaiWs.on('message', (data) => {
        // Forward OpenAI messages to the browser client
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data.toString());
        }
    });

    openaiWs.on('close', (code, reason) => {
        console.log(`OpenAI connection closed: ${code} ${reason}`);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1000, 'OpenAI connection closed');
        }
    });

    openaiWs.on('error', (error) => {
        console.error('OpenAI WebSocket error:', error.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, 'OpenAI connection error');
        }
    });

    // Handle messages from browser client
    clientWs.on('message', (data) => {
        const message = data.toString();

        if (openaiConnected && openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.send(message);
        } else {
            // Queue messages until OpenAI connection is ready
            messageQueue.push(message);
        }
    });

    clientWs.on('close', () => {
        console.log('Client disconnected');
        if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });

    clientWs.on('error', (error) => {
        console.error('Client WebSocket error:', error.message);
        if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.close();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`WebSocket proxy available at ws://localhost:${PORT}/ws`);
    console.log(`Audio uploads will be written to ${AUDIO_FILE}`);
    console.log('API key is securely stored on server (not exposed to browser)');
});
