from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class SourceFetchResult:
    local_path: str
    bytes_fetched: int


class SourceAdapter(Protocol):
    def fetch(
        self,
        file_id: str,
        *,
        access_token: str,
        dest_path: str,
    ) -> SourceFetchResult:
        """Download the file referenced by `file_id` to `dest_path`."""
