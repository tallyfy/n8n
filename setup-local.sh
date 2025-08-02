#!/bin/bash

echo "========================================="
echo "Tallyfy n8n Node - Local Setup Script"
echo "========================================="
echo ""

# Check if n8n is installed
echo "Checking for n8n installation..."
if command -v n8n &> /dev/null; then
    N8N_VERSION=$(n8n --version 2>/dev/null || echo "unknown")
    echo "✓ n8n found (version: $N8N_VERSION)"
else
    echo "✗ n8n not found"
    echo ""
    echo "To install n8n globally:"
    echo "  npm install -g n8n"
    echo ""
    echo "Or run with npx:"
    echo "  npx n8n"
    echo ""
    exit 1
fi

# Build the node
echo ""
echo "Building the Tallyfy node..."
if [ -f "build.sh" ]; then
    ./build.sh
else
    echo "Running TypeScript compiler..."
    ./node_modules/.bin/tsc
    echo "Copying icons..."
    ./node_modules/.bin/gulp build:icons
fi

# Link the package
echo ""
echo "Linking the package for local development..."
npm link

echo ""
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "To use this node in your local n8n:"
echo ""
echo "1. Navigate to your n8n custom nodes directory:"
echo "   - Default: ~/.n8n/custom/"
echo "   - Or set N8N_CUSTOM_EXTENSIONS_DIR environment variable"
echo ""
echo "2. Link the package there:"
echo "   cd ~/.n8n/custom/"
echo "   npm link n8n-nodes-tallyfy"
echo ""
echo "3. Start n8n:"
echo "   n8n start"
echo ""
echo "4. The Tallyfy node should appear in the nodes panel!"
echo ""
echo "For testing with credentials:"
echo "   export TALLYFY_TOKEN='your-token'"
echo "   export TALLYFY_ORG='your-org-id'"
echo "   node test-api.js"
echo ""