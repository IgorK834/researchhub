"""Safe, bounded tabular metadata for analysis planning."""

from .contracts import DatasetPreview
from .preview import build_dataset_preview

__all__ = ["DatasetPreview", "build_dataset_preview"]
