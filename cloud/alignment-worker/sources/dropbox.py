from __future__ import annotations

import os

import requests

from .base import SourceAdapter, SourceFetchResult


class DropboxAdapter(SourceAdapter):
    """Thin wrapper around the /files/download endpoint.

    The RN client already holds the user's Dropbox OAuth token (Phase 2 of the
    broader project). The job spec forwards a short-lived token via Cloud Run
    env so it never appears in logs.
    """

    ENDPOINT = "https://content.dropboxapi.com/2/files/download"

    def fetch(
        self,
        file_id: str,
        *,
        access_token: str,
        dest_path: str,
    ) -> SourceFetchResult:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Dropbox-API-Arg": f'{{"path":"{file_id}"}}',
        }
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        total = 0
        with requests.post(self.ENDPOINT, headers=headers, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
                    total += len(chunk)
        return SourceFetchResult(local_path=dest_path, bytes_fetched=total)
