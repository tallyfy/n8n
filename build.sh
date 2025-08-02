#!/bin/bash

echo "Building n8n-nodes-tallyfy..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Error: node_modules not found. Please run 'npm install' first."
    exit 1
fi

# Run TypeScript compiler
echo "Compiling TypeScript..."
npx tsc

# Copy icons
echo "Copying icons..."
npx gulp build:icons

echo "Build complete! Files are in the dist/ directory."