#!/usr/bin/env bash
# Usage: ./scripts/aeneas-runner.sh book.epub book.m4b
# Requirements: python3, aeneas (pip install aeneas), ffmpeg, ffprobe
# Output: sync_map.json in the same directory as the audio file

set -euo pipefail

EPUB_FILE="${1:?Usage: $0 book.epub book.m4b}"
AUDIO_FILE="${2:?Usage: $0 book.epub book.m4b}"
OUTPUT_DIR="$(dirname "$AUDIO_FILE")"
SYNC_MAP_OUT="$OUTPUT_DIR/sync_map.json"
CHAPTERS_OUT="$OUTPUT_DIR/chapters.json"
WORK_DIR="$(mktemp -d)"

echo "📚 EPUB: $EPUB_FILE"
echo "🔊 Audio: $AUDIO_FILE"
echo "📁 Work dir: $WORK_DIR"

# Step 1: Extract chapters from M4B using ffprobe
echo ""
echo "⏳ Extracting chapters..."
ffprobe -v quiet -print_format json -show_chapters "$AUDIO_FILE" > "$CHAPTERS_OUT"
CHAPTER_COUNT=$(python3 -c "
import json, sys
data = json.load(open('$CHAPTERS_OUT'))
print(len(data.get('chapters', [])))
")
echo "✅ Found $CHAPTER_COUNT chapters → $CHAPTERS_OUT"

if [ "$CHAPTER_COUNT" -eq 0 ]; then
  echo "⚠️  No chapters found. Running aeneas on full audio..."
  # Run aeneas on the full epub + audio
  python3 -m aeneas.tools.execute_task \
    "$AUDIO_FILE" \
    "$EPUB_FILE" \
    "task_language=eng|is_audio_file_detect_head_max=10|os_task_file_format=json" \
    "$SYNC_MAP_OUT"
else
  # Step 2: Split audio by chapter and run aeneas per chapter
  echo ""
  echo "⏳ Running aeneas per chapter..."
  python3 << PYTHON_SCRIPT
import json
import subprocess
import os
import shutil

chapters = json.load(open("$CHAPTERS_OUT")).get("chapters", [])
work = "$WORK_DIR"
audio = "$AUDIO_FILE"
epub = "$EPUB_FILE"
all_fragments = []

for i, ch in enumerate(chapters):
    start = float(ch["start_time"])
    end = float(ch["end_time"])
    duration = end - start
    title = ch.get("tags", {}).get("title", f"Chapter {i+1}")

    # Extract chapter audio
    chunk_audio = os.path.join(work, f"chapter_{i:04d}.mp3")
    subprocess.run([
        "ffmpeg", "-y", "-ss", str(start), "-t", str(duration),
        "-i", audio, "-q:a", "2", chunk_audio
    ], check=True, capture_output=True)

    # Create a minimal epub text for this chapter (just use chapter title as text)
    # For a real run, you'd extract the actual text from the epub per chapter
    chunk_text = os.path.join(work, f"chapter_{i:04d}.txt")
    with open(chunk_text, "w") as f:
        f.write(f"Chapter {i+1}: {title}")

    # Run aeneas
    chunk_map = os.path.join(work, f"chapter_{i:04d}_map.json")
    result = subprocess.run([
        "python3", "-m", "aeneas.tools.execute_task",
        chunk_audio, chunk_text,
        "task_language=eng|os_task_file_format=json",
        chunk_map
    ], capture_output=True)

    if result.returncode == 0 and os.path.exists(chunk_map):
        chapter_map = json.load(open(chunk_map))
        # Adjust timestamps to be relative to full audio file
        for fragment in chapter_map.get("fragments", []):
            begin_parts = fragment["begin"].split(":")
            end_parts = fragment["end"].split(":")
            def to_seconds(parts):
                h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
                return h * 3600 + m * 60 + s
            def to_time_str(secs):
                h = int(secs // 3600)
                m = int((secs % 3600) // 60)
                s = secs % 60
                return f"{h}:{m:02d}:{s:06.3f}"
            begin_abs = to_seconds(begin_parts) + start
            end_abs = to_seconds(end_parts) + start
            fragment["begin"] = to_time_str(begin_abs)
            fragment["end"] = to_time_str(end_abs)
            fragment["chapter_index"] = i
        all_fragments.extend(chapter_map.get("fragments", []))
    else:
        print(f"  ⚠️  aeneas failed for chapter {i}")

sync_map = {"fragments": all_fragments}
with open("$SYNC_MAP_OUT", "w") as f:
    json.dump(sync_map, f, indent=2)

print(f"✅ sync_map.json written with {len(all_fragments)} fragments")
PYTHON_SCRIPT
fi

echo ""
echo "✅ Done!"
echo "   chapters.json → $CHAPTERS_OUT"
echo "   sync_map.json → $SYNC_MAP_OUT"
echo ""
echo "Next step: run ./scripts/upload-book.sh to upload to Dropbox"

# Cleanup
rm -rf "$WORK_DIR"
