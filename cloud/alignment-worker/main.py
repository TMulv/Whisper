"""
Cloud Run entry point. One job = one book alignment.

Job spec arrives as JSON in the HTTP POST body — dispatched by a Firebase
Function that listens to `/alignmentJobs/{jobId}` in Firestore. The worker:

  1. Pulls m4b + epub from the user's source adapter.
  2. Parses chapter boundaries from the m4b.
  3. Tokenizes the epub per chapter.
  4. Transcribes each chapter with Whisper (word timestamps).
  5. DTW-aligns tokens, writes SentenceAnchor[] per chapter to Firestore.
  6. Updates job status as it goes (idempotent — a restart picks up where it
     left off by skipping chapters that already have anchors).

Firestore paths (keep in sync with `src/types/firebase.ts`):
  users/{userId}/books/{bookId}/alignment/{chapterIndex}  → anchor list
  users/{userId}/books/{bookId}                            → status, progress
  alignmentJobs/{jobId}                                    → job tracking
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path

import firebase_admin
import whisper
from firebase_admin import firestore
from flask import Flask, jsonify, request

from aligner import WhisperToken, align_tokens, extract_anchors
from epub_tokenizer import tokenize_book
from sources import get_adapter


app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("aligner")

firebase_admin.initialize_app()
db = firestore.client()
MODEL = whisper.load_model(os.environ.get("WHISPER_MODEL", "small"))


def probe_chapters(audio_path: str) -> list[dict]:
    """Read m4b chapter metadata via ffprobe. Output mirrors M4BChapter[]."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_chapters", "-of", "json", audio_path],
        capture_output=True,
        text=True,
        check=True,
    )
    import json as _json
    data = _json.loads(result.stdout)
    out = []
    for i, ch in enumerate(data.get("chapters", [])):
        start = float(ch.get("start_time", 0))
        end = float(ch.get("end_time", 0))
        title = ch.get("tags", {}).get("title", f"Chapter {i + 1}")
        out.append({"index": i, "title": title, "startSeconds": start, "endSeconds": end})
    return out


def extract_chapter_audio(audio_path: str, start: float, end: float, dest: str) -> None:
    """Slice the chapter to 16 kHz mono WAV — what Whisper wants."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start}", "-to", f"{end}",
            "-i", audio_path,
            "-ac", "1", "-ar", "16000",
            dest,
        ],
        check=True,
    )


def transcribe_chapter(audio_path: str, start: float, end: float) -> list[WhisperToken]:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        extract_chapter_audio(audio_path, start, end, tf.name)
        chunk_path = tf.name
    try:
        result = MODEL.transcribe(chunk_path, word_timestamps=True, language="en")
    finally:
        os.unlink(chunk_path)

    tokens: list[WhisperToken] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            text = (w.get("word") or w.get("text") or "").strip()
            if not text:
                continue
            tokens.append(
                WhisperToken(
                    text=text,
                    # word times are relative to the chunk; shift by chapter start
                    start_seconds=start + float(w.get("start", 0.0)),
                    end_seconds=start + float(w.get("end", 0.0)),
                    confidence=float(w.get("probability", 1.0)),
                )
            )
    return tokens


def write_chapter_anchors(user_id: str, book_id: str, chapter_index: int, anchors: list) -> None:
    ref = db.collection("users").document(user_id) \
            .collection("books").document(book_id) \
            .collection("alignment").document(str(chapter_index))
    ref.set({"anchors": [a.to_firestore() for a in anchors], "updatedAt": int(time.time() * 1000)})


def update_job(job_id: str, patch: dict) -> None:
    db.collection("alignmentJobs").document(job_id).set(patch, merge=True)


def update_book_status(user_id: str, book_id: str, patch: dict) -> None:
    db.collection("users").document(user_id) \
      .collection("books").document(book_id) \
      .collection("alignment").document("status") \
      .set(patch, merge=True)


def already_done(user_id: str, book_id: str, chapter_index: int) -> bool:
    doc = db.collection("users").document(user_id) \
            .collection("books").document(book_id) \
            .collection("alignment").document(str(chapter_index)).get()
    return doc.exists and bool(doc.to_dict().get("anchors"))


@app.post("/")
def run_job():
    spec = request.get_json(force=True)
    job_id = spec["jobId"]
    user_id = spec["userId"]
    book_id = spec["bookId"]
    source = spec["source"]           # "dropbox" | "drive"
    access_token = spec["accessToken"]
    audio_file_id = spec["audioFileId"]
    epub_file_id = spec["epubFileId"]

    log.info("job=%s user=%s book=%s source=%s", job_id, user_id, book_id, source)
    update_job(job_id, {"status": "running", "startedAt": int(time.time() * 1000)})

    tmp = Path(tempfile.mkdtemp(prefix=f"job-{job_id}-"))
    try:
        adapter = get_adapter(source)
        audio_local = adapter.fetch(audio_file_id, access_token=access_token, dest_path=str(tmp / "book.m4b")).local_path
        epub_local = adapter.fetch(epub_file_id, access_token=access_token, dest_path=str(tmp / "book.epub")).local_path

        chapters = probe_chapters(audio_local)
        epub_tokens_by_chapter = tokenize_book(epub_local)

        update_book_status(user_id, book_id, {
            "status": "processing",
            "totalChapters": len(chapters),
            "completedChapters": 0,
        })

        completed = 0
        for ch in chapters:
            idx = ch["index"]
            if already_done(user_id, book_id, idx):
                completed += 1
                continue
            epub_tokens = epub_tokens_by_chapter.get(idx, [])
            if not epub_tokens:
                write_chapter_anchors(user_id, book_id, idx, [])
                completed += 1
                update_book_status(user_id, book_id, {"completedChapters": completed})
                continue
            whisper_tokens = transcribe_chapter(audio_local, ch["startSeconds"], ch["endSeconds"])
            pairs, _ = align_tokens(whisper_tokens, epub_tokens)
            anchors = extract_anchors(whisper_tokens, epub_tokens, pairs)
            write_chapter_anchors(user_id, book_id, idx, anchors)
            completed += 1
            update_book_status(user_id, book_id, {"completedChapters": completed})
            update_job(job_id, {"completedChapters": completed})

        update_book_status(user_id, book_id, {"status": "complete", "completedAt": int(time.time() * 1000)})
        update_job(job_id, {"status": "complete", "completedAt": int(time.time() * 1000)})
        return jsonify({"ok": True, "chapters": completed})

    except Exception as e:
        log.exception("job failed")
        update_job(job_id, {"status": "failed", "error": str(e), "failedAt": int(time.time() * 1000)})
        update_book_status(user_id, book_id, {"status": "failed", "error": str(e)})
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
