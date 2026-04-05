#!/usr/bin/env bash
# Usage: ./scripts/upload-book.sh <epub_file> <audio_file> [sync_map.json] [chapters.json]
# Uploads book files to Dropbox /Apps/Whisper/{book_title}/
# Requires: DROPBOX_ACCESS_TOKEN env var (get from https://www.dropbox.com/developers)

set -euo pipefail

EPUB_FILE="${1:?Usage: $0 book.epub book.m4b [sync_map.json] [chapters.json]}"
AUDIO_FILE="${2:?Usage: $0 book.epub book.m4b [sync_map.json] [chapters.json]}"
SYNC_MAP="${3:-}"
CHAPTERS="${4:-}"

ACCESS_TOKEN="${DROPBOX_ACCESS_TOKEN:?Set DROPBOX_ACCESS_TOKEN env var}"

# Extract book title from epub filename (strip extension, replace spaces)
BOOK_TITLE="$(basename "$EPUB_FILE" .epub | sed 's/ /_/g')"
DROPBOX_FOLDER="/Apps/Whisper/$BOOK_TITLE"

echo "📤 Uploading to Dropbox: $DROPBOX_FOLDER"

upload_file() {
  local local_path="$1"
  local dropbox_path="$2"
  local filename="$(basename "$local_path")"

  echo "  ⏳ Uploading $filename..."
  curl -s -X POST "https://content.dropboxapi.com/2/files/upload" \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    --header "Dropbox-API-Arg: {\"path\":\"$dropbox_path\",\"mode\":\"overwrite\",\"autorename\":false}" \
    --header "Content-Type: application/octet-stream" \
    --data-binary "@$local_path" \
    > /dev/null
  echo "  ✅ $filename uploaded"
}

# Upload epub
upload_file "$EPUB_FILE" "$DROPBOX_FOLDER/$(basename "$EPUB_FILE")"

# Upload audio (large files — use upload session for >150MB)
AUDIO_SIZE=$(wc -c < "$AUDIO_FILE")
if [ "$AUDIO_SIZE" -gt 150000000 ]; then
  echo "  ⏳ Uploading $(basename "$AUDIO_FILE") (large file — using session)..."
  # Start upload session
  SESSION_ID=$(curl -s -X POST "https://content.dropboxapi.com/2/files/upload_session/start" \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    --header "Dropbox-API-Arg: {\"close\":false}" \
    --header "Content-Type: application/octet-stream" \
    --data-binary "" | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])")

  OFFSET=0
  CHUNK_SIZE=104857600  # 100 MB chunks
  while [ "$OFFSET" -lt "$AUDIO_SIZE" ]; do
    REMAINING=$((AUDIO_SIZE - OFFSET))
    IS_LAST=false
    if [ "$REMAINING" -le "$CHUNK_SIZE" ]; then IS_LAST=true; fi

    if [ "$IS_LAST" = "true" ]; then
      curl -s -X POST "https://content.dropboxapi.com/2/files/upload_session/finish" \
        --header "Authorization: Bearer $ACCESS_TOKEN" \
        --header "Dropbox-API-Arg: {\"cursor\":{\"session_id\":\"$SESSION_ID\",\"offset\":$OFFSET},\"commit\":{\"path\":\"$DROPBOX_FOLDER/$(basename "$AUDIO_FILE")\",\"mode\":\"overwrite\"}}" \
        --header "Content-Type: application/octet-stream" \
        --data-binary "@$AUDIO_FILE" > /dev/null
    else
      curl -s -X POST "https://content.dropboxapi.com/2/files/upload_session/append_v2" \
        --header "Authorization: Bearer $ACCESS_TOKEN" \
        --header "Dropbox-API-Arg: {\"cursor\":{\"session_id\":\"$SESSION_ID\",\"offset\":$OFFSET},\"close\":false}" \
        --header "Content-Type: application/octet-stream" \
        --data-binary "@$AUDIO_FILE" > /dev/null
    fi
    OFFSET=$((OFFSET + CHUNK_SIZE))
  done
  echo "  ✅ $(basename "$AUDIO_FILE") uploaded"
else
  upload_file "$AUDIO_FILE" "$DROPBOX_FOLDER/$(basename "$AUDIO_FILE")"
fi

# Upload optional files
if [ -n "$SYNC_MAP" ] && [ -f "$SYNC_MAP" ]; then
  upload_file "$SYNC_MAP" "$DROPBOX_FOLDER/sync_map.json"
fi

if [ -n "$CHAPTERS" ] && [ -f "$CHAPTERS" ]; then
  upload_file "$CHAPTERS" "$DROPBOX_FOLDER/chapters.json"
else
  # Auto-detect chapters.json in same dir as audio
  CHAPTERS_AUTO="$(dirname "$AUDIO_FILE")/chapters.json"
  if [ -f "$CHAPTERS_AUTO" ]; then
    upload_file "$CHAPTERS_AUTO" "$DROPBOX_FOLDER/chapters.json"
  fi
fi

echo ""
echo "✅ Upload complete!"
echo "   Dropbox path: $DROPBOX_FOLDER"
