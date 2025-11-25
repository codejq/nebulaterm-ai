#!/bin/bash

# Navigate to the project root if the script is run from the scripts directory
cd "$(dirname "$0")/.." || exit

echo "Installing dependencies..."
npm install

echo "Checking for Rust..."
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust is not installed or not in PATH."
    echo "Please install Rust from https://rustup.rs/ and restart your terminal."
    exit 1
fi

echo "Building frontend..."
npm run build

echo "Building Tauri application..."
npm run tauri build
