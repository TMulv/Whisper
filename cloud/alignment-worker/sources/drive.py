from __future__ import annotations

import os

import requests

from .base import SourceAdapter, SourceFetchResult


class GoogleDriveAdapter(SourceAdapter):
    """files.get with alt=media — standard Drive download pattern."""

    def endpoint(self, file_id: str) -> str:
        return f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

    def fetch(
        self,
        file_id: str,
        *,
        access_token: str,
        dest_path: str,
    ) -> SourceFetchResult:
        headers = {"Authorization": f"Bearer {access_token}"}
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        total = 0
        with requests.get(self.endpoint(file_id), headers=headers, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
                    total += len(chunk)
        return SourceFetchResult(local_path=dest_path, bytes_fetched=total)
