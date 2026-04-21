"""
Source adapters for pulling a user's m4b + epub out of their cloud provider.

Each adapter takes a provider-specific file id and short-lived credentials
and returns a local byte-stream path usable by ffmpeg / ebooklib. Adapters
do not retain credentials beyond the call.
"""

from .base import SourceAdapter, SourceFetchResult
from .dropbox import DropboxAdapter
from .drive import GoogleDriveAdapter

ADAPTERS: dict[str, SourceAdapter] = {
    "dropbox": DropboxAdapter(),
    "drive": GoogleDriveAdapter(),
}


def get_adapter(source: str) -> SourceAdapter:
    try:
        return ADAPTERS[source]
    except KeyError as e:
        raise ValueError(f"unsupported source: {source}") from e
