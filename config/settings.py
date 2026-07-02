from __future__ import annotations

from functools import cached_property
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field

from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLAW_", extra="ignore")

    # ===== 项目根目录 =====
    project_root: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[1])

    # ===== LLM 配置 =====
    model: str = "qwen3.5-122b-a10b"
    api_key: str = ""
    base_url: str | None = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    # ===== 数据目录 =====
    data_dir: Path = Field(default_factory=lambda: Settings._root() / "data")
    database_path: Path = Field(default_factory=lambda: Settings._root() / "data" / "claw.db")

    # ===== 日志 =====
    log_level: str = "DEBUG"
    log_dir: Path = Field(default_factory=lambda: Settings._root() / "data" / "logs")
    log_to_console: bool = True
    log_to_file: bool = True

    # ===== 审计 =====
    audit_enabled: bool = True
    audit_log_dir: Path = Field(default_factory=lambda: Settings._root() / "data" / "audit")

    # ===== Agent 运行参数 =====
    max_iterations: int = 15
    max_context_turns: int = 16
    max_context_chars: int = 400000
    max_history_messages: int = 12
    max_memory_items: int = 10
    memory_distill_threshold: int = 2
    memory_distill_min_convs: int = 1
    memory_stale_days: int = 90
    memory_stm_expire_days: int = 30
    memory_extraction_enabled: bool = True
    use_native_tool_calling: bool = True

    # ===== 安全策略 =====
    shell_timeout_seconds: int = 20
    allow_shell: bool = True
    allow_http: bool = True

    # ===== 后端存储 =====
    redis_url: str = "redis://localhost:6379/0"
    session_backend: str = "file"
    rate_limit_rpm: int = 60

    # ===== 情绪检测 =====
    emotion_enabled: bool = True
    emotion_backend: str = "local"

    # ===== 监控 =====
    metrics_enabled: bool = True
    metrics_port: int = 9090

    @staticmethod
    def _root() -> Path:
        return Path(__file__).resolve().parents[1]

    @cached_property
    def builtin_agents_dir(self) -> Path:
        return self.project_root / "application" / "builtin_agents"

    @cached_property
    def skills_dir(self) -> Path:
        return self.project_root / "infrastructure" / "skills" / "builtin"

    @cached_property
    def mcp_servers_dir(self) -> Path:
        return self.project_root / "infrastructure" / "mcp" / "servers"


settings = Settings()
