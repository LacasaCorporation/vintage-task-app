#!/usr/bin/env bash
# Vintage Task App - Local Setup Script (Linux/Mac/Git Bash)

set -e

echo "============================================"
echo "Vintage Task App - Local Setup Script"
echo "============================================"
echo

echo "[1/4] Installing dependencies..."
npm install

echo
echo "[2/4] Setting up Convex local backend..."
echo "This will open a browser for Convex login (first time only)."
echo "After login, it will start the local Convex backend at http://localhost:3210"
echo
read -p "Press Enter to continue..."

npx convex dev --configure=new --dev-deployment local

echo
echo "[3/4] Convex is now running!"
echo "The local Convex URL should be: http://localhost:3210"
echo "This is already configured in .env.local"
echo

echo "[4/4] Starting Vite dev server..."
echo "The app will be available at http://localhost:5173"
echo
npm run dev