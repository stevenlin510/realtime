#!/usr/bin/env node
/**
 * Build script that embeds the API key into the executable.
 *
 * Usage:
 *   node build.js [platform]
 *
 * Platforms: mac, win, all (default: all)
 *
 * The API key is read from .env file.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read API key from .env
const envPath = path.resolve(__dirname, '.env');
if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found!');
    console.error('Please create .env with OPENAI_API_KEY=sk-your-key');
    process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
let apiKey = null;
for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('OPENAI_API_KEY=')) {
        apiKey = trimmed.substring('OPENAI_API_KEY='.length).trim();
        break;
    }
}

if (!apiKey || apiKey === 'sk-your-api-key-here') {
    console.error('ERROR: Valid OPENAI_API_KEY not found in .env');
    process.exit(1);
}

console.log('API key found, embedding into build...');

// Read server.js
const serverPath = path.resolve(__dirname, 'server.js');
const serverContent = fs.readFileSync(serverPath, 'utf-8');

// Create modified version with embedded key
let modifiedContent = serverContent;

// 1. Embed the API key (fallback to embedded if env not set)
modifiedContent = modifiedContent.replace(
    "const OPENAI_API_KEY = process.env.OPENAI_API_KEY;",
    `const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '${apiKey}';`
);

// 2. Skip .env creation for packaged app (key is embedded)
modifiedContent = modifiedContent.replace(
    "} else if (isPkg) {\n    console.log('');\n    console.log('='.repeat(60));\n    console.log('First time setup: Creating .env file...');",
    "} else if (isPkg && false) { // Disabled: API key is embedded\n    console.log('');\n    console.log('='.repeat(60));\n    console.log('First time setup: Creating .env file...');"
);

// Write to temp file
const tempServerPath = path.resolve(__dirname, 'server.build.js');
fs.writeFileSync(tempServerPath, modifiedContent);

// Update package.json temporarily to use the temp file
const pkgPath = path.resolve(__dirname, 'package.json');
const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
const pkgJson = JSON.parse(pkgContent);
const originalBin = pkgJson.bin;
pkgJson.bin = 'server.build.js';
fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2));

// Determine target platform
const platform = process.argv[2] || 'all';
const targets = {
    mac: 'node18-macos-arm64',
    win: 'node18-win-x64',
    all: 'node18-macos-arm64,node18-win-x64'
};

const target = targets[platform];
if (!target) {
    console.error(`Unknown platform: ${platform}`);
    console.error('Valid platforms: mac, win, all');
    cleanup();
    process.exit(1);
}

console.log(`Building for: ${platform}`);

try {
    execSync(`npx pkg . --targets ${target} --compress GZip`, {
        stdio: 'inherit',
        cwd: __dirname
    });
    console.log('\nBuild complete! Executables are in dist/');
    console.log('API key is embedded - no .env needed for users.');
} catch (error) {
    console.error('Build failed:', error.message);
} finally {
    cleanup();
}

function cleanup() {
    // Restore package.json
    pkgJson.bin = originalBin;
    fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');

    // Remove temp file
    if (fs.existsSync(tempServerPath)) {
        fs.unlinkSync(tempServerPath);
    }
}
