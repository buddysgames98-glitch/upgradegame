#!/bin/bash

REPO_DIR="$(dirname "$(realpath "$0")")"
POLL_INTERVAL=30  # seconds between checks

cd "$REPO_DIR"

echo "Watching $REPO_DIR for updates..."

while true; do
    git fetch origin main --quiet

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)

    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "[$(date)] New commit detected. Pulling and restarting..."
        git pull origin main
        docker compose up --build -d
        docker image prune -f
        echo "[$(date)] Done."
    fi

    sleep "$POLL_INTERVAL"
done
