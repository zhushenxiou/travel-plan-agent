from __future__ import annotations

import logging
from pathlib import Path


def setup_logging(
    *,
    log_level: str = "INFO",
    log_dir: Path | None = None,
    log_to_console: bool = True,
    log_to_file: bool = True,
) -> None:
    root = logging.getLogger()
    if getattr(root, "_claw_logging_configured", False):
        return

    root.setLevel(getattr(logging, log_level.upper(), logging.DEBUG))
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if log_to_console:
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        root.addHandler(console_handler)

    if log_to_file and log_dir is not None:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(Path(log_dir) / "claw.log", encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

    root._claw_logging_configured = True  # type: ignore[attr-defined]
