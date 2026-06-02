from __future__ import annotations

from pathlib import Path
from core.agent import Agent
from core.llm import OpenAILLM
from core.logging_config import init_from_settings
from core.prompting import PromptBuilder
from tools.interaction import get_interaction_handlers, get_interaction_specs
from core.session import SessionManager
from tools.executor import ToolExecutor
from tools.http import get_http_handlers, get_http_specs
from tools.travel import get_travel_handlers, get_travel_specs
from tools.amap import get_amap_handlers, get_amap_specs
from tools.fliggy import get_fliggy_handlers, get_fliggy_specs
from tools.policy import ToolPolicy
from tools.registry import ToolRegistry
from tools.catalog import ToolCatalog
from tools.base import bind_tool
from core.mcp_catalog import MCPCatalog
from tools.mcp import MCPProxyRuntime
from core.intent.travel_classifier import TravelIntentClassifier
from core.emotion.detector import EmotionDetector
from core.profile.manager import ProfileManager
from core.audit.logger import AuditLogger
from core.metrics.collector import start_metrics_server
from infra.db import init_db

def build_agent() -> Agent:
    init_from_settings()
    init_db()
    audit_logger = AuditLogger()
    llm = OpenAILLM(audit_logger=audit_logger)
    prompt_builder = PromptBuilder()
    session_store = SessionManager()
    tool_catalog = ToolCatalog()
    tool_registry = ToolRegistry()
    tool_policy = ToolPolicy()
    mcp_catalog = MCPCatalog(Path(__file__).resolve().parents[0] / "mcps")
    mcp_runtime = MCPProxyRuntime(catalog=mcp_catalog)

    travel_classifier = TravelIntentClassifier(llm=llm)
    emotion_detector = EmotionDetector(llm=llm)
    profile_manager = ProfileManager()

    all_specs = (
        get_http_specs()
        + get_interaction_specs()
        + get_travel_specs()
        + get_amap_specs()
        + get_fliggy_specs()
        + mcp_runtime.build_specs()
    )
    for spec in all_specs:
        tool_catalog.register(spec)

    all_handlers = {}
    all_handlers.update(get_http_handlers())
    all_handlers.update(get_interaction_handlers())
    all_handlers.update(get_travel_handlers())
    all_handlers.update(get_amap_handlers())
    all_handlers.update(get_fliggy_handlers())
    all_handlers.update(mcp_runtime.build_handlers())

    for spec in tool_catalog.list_specs():
        tool_registry.register(bind_tool(spec, all_handlers[spec.name]))

    tool_executor = ToolExecutor(registry=tool_registry, policy=tool_policy, audit_logger=audit_logger)

    start_metrics_server()

    return Agent(
        llm=llm,
        prompt_builder=prompt_builder,
        session_store=session_store,
        tool_registry=tool_registry,
        tool_executor=tool_executor,
        mcp_catalog=mcp_catalog,
        mcp_runtime=mcp_runtime,
        ops_classifier=travel_classifier,
        emotion_detector=emotion_detector,
        profile_manager=profile_manager,
        audit_logger=audit_logger,
    )
