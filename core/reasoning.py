from __future__ import annotations
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any
from config import settings
import re
from tools.executor import ToolExecutor
from tools.registry import ToolRegistry
from core.llm import OpenAILLM, LLMResponse, ToolCallResult as LLMToolCall
from core.types import Decision, DecisionType, ToolCall

logger = logging.getLogger(__name__)


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped.strip()


def _extract_json_by_brackets(text: str) -> str | None:
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        c = text[i]
        if escape:
            escape = False
            continue
        if c == "\\" and in_string:
            escape = True
            continue
        if c == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = _strip_code_fences(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        extracted = _extract_json_by_brackets(cleaned)
        if not extracted:
            raise
        data = json.loads(extracted)
    if not isinstance(data, dict):
        raise ValueError("reasoning output was not a JSON object")
    return data


REACT_SYSTEM_SUFFIX = """You MUST return exactly one of the following two formats.

Format 1 - Final answer (plain text only):
Return just the plain text response for the user. No JSON, no tags, no code blocks.
Do NOT wrap your answer in a JSON object like {{"text": "..."}}. Just write the answer directly.
Your final answer MUST be natural language that the user can read directly.

CRITICAL RULES for Format 1:
- NEVER include your internal reasoning, planning, or thinking process in the final answer.
- Do NOT write things like "Now I have enough information", "Let me compile", "Key findings:", "Let me now", "I will now", etc.
- The final answer should be a polished, direct response to the user — as if a human expert wrote it.
- You MUST write in the SAME LANGUAGE as the user's message. If the user writes in Chinese, your final answer MUST be in Chinese.
- Do NOT mix English reasoning with Chinese content. The entire final answer must be in the user's language.

Format 2 - Tool calls (JSON only, NO XML):
{{
  "tool_calls": [
    {{"name": "tool_name", "arguments": {{"arg": "value"}}}}
  ],
  "text": "optional short note"
}}

CRITICAL RULES for Format 2:
- The JSON MUST start with {{ and end with }}. Do NOT omit the opening or closing braces.
- Do NOT add any text before or after the JSON object.
- Do NOT use XML tags like <tool_call/>. Use ONLY the JSON format shown above.
- Each tool call MUST have both "name" and "arguments" keys.

IMPORTANT: NEVER use XML tags. Always use the JSON format above.
If you need tools, return ONLY the JSON object, no text before or after it.
Only use JSON when you actually need to call tools.
When you have enough tool results, you MUST switch to Format 1 (plain text).
NEVER return JSON as your final answer to the user.
"""


@dataclass
class TraceStep:
    iteration: int
    decision_type: str
    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    system_note: str = ""


class AskUserNeeded(Exception):
    def __init__(self, question: str) -> None:
        super().__init__(question)
        self.question = question


class ConfirmationNeeded(Exception):
    def __init__(self, prompt: str) -> None:
        super().__init__(prompt)
        self.prompt = prompt


class ReasoningEngine:
    def __init__(
        self,
        *,
        llm: OpenAILLM,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        audit_logger: Any | None = None,
    ) -> None:
        self._llm = llm
        self._tool_registry = tool_registry
        self._tool_executor = tool_executor
        self._audit_logger = audit_logger
        self.last_trace: list[TraceStep] = []
        self._tools_schema: list[dict[str, Any]] | None = None
        self._audit_session_id: str = ""
        self._audit_user_id: str = ""

    def set_audit_context(self, *, session_id: str, user_id: str) -> None:
        self._audit_session_id = session_id
        self._audit_user_id = user_id

    def _record_trace(self, trace: TraceStep) -> None:
        self.last_trace.append(trace)
        if self._audit_logger:
            self._audit_logger.log_reasoning_step(
                session_id=self._audit_session_id,
                user_id=self._audit_user_id,
                iteration=trace.iteration,
                decision_type=trace.decision_type,
                text=trace.text,
                tool_calls=trace.tool_calls,
                tool_results=trace.tool_results,
                system_note=trace.system_note,
            )

    def _build_tools_schema(self) -> list[dict[str, Any]]:
        if self._tools_schema is not None:
            return self._tools_schema
        schema: list[dict[str, Any]] = []
        for name in self._tool_registry._tools:
            tool = self._tool_registry._tools[name]
            spec = tool.spec
            func_def: dict[str, Any] = {
                "type": "function",
                "function": {
                    "name": spec.name,
                    "description": spec.description,
                },
            }
            if spec.parameters:
                func_def["function"]["parameters"] = spec.parameters
            else:
                func_def["function"]["parameters"] = {
                    "type": "object",
                    "properties": {},
                }
            schema.append(func_def)
        self._tools_schema = schema
        return schema

    def _llm_response_to_decision(self, llm_resp: LLMResponse) -> Decision:
        if llm_resp.has_tool_calls and llm_resp.tool_calls:
            tool_calls = [
                ToolCall(
                    name=tc.name,
                    arguments=tc.arguments,
                    call_id=tc.id or str(uuid.uuid4()),
                )
                for tc in llm_resp.tool_calls
            ]
            return Decision(
                decision_type=DecisionType.TOOL_CALLS,
                text=llm_resp.content or "",
                tool_calls=tool_calls,
            )
        content = llm_resp.content or ""
        if content.strip():
            return Decision(
                decision_type=DecisionType.FINAL_ANSWER,
                text=content,
            )
        return Decision(decision_type=DecisionType.FINAL_ANSWER, text="")

    async def run(self, *, system_prompt: str, user_message: str, force_tool: bool) -> str:
        working_messages: list[dict[str, str]] = [{"role": "user", "content": user_message}]
        self.last_trace = []
        no_tool_rounds = 0
        ungrounded_rounds = 0
        best_text = ""
        tools_executed = False
        seen_signatures: dict[str, int] = {}
        use_native = getattr(settings, "use_native_tool_calling", True)
        tools_schema = self._build_tools_schema() if use_native else None

        for iteration in range(1, settings.max_iterations + 1):
            logger.info("===== Reasoning iteration %s/%s =====", iteration, settings.max_iterations)

            near_limit = iteration >= settings.max_iterations - 2

            if use_native and tools_schema:
                llm_resp = await self._llm.complete_with_tools(
                    system=system_prompt,
                    messages=working_messages,
                    tools=tools_schema if not near_limit else None,
                )
                decision = self._llm_response_to_decision(llm_resp)
                if not decision.text and not decision.tool_calls:
                    decision = self._parse_decision(llm_resp.content or "")
            else:
                response = await self._llm.complete(
                    system=system_prompt + "\n\n" + REACT_SYSTEM_SUFFIX,
                    messages=working_messages,
                )
                decision = self._parse_decision(response)
            logger.info(
                "Decision: type=%s tool_calls=%s text_preview=%s",
                decision.decision_type.value,
                [call.name for call in decision.tool_calls],
                decision.text[:100] if decision.text else "",
            )
            trace = TraceStep(
                iteration=iteration,
                decision_type=decision.decision_type.value,
                text=decision.text,
                tool_calls=[
                    {"name": call.name, "arguments": call.arguments, "id": call.call_id}
                    for call in decision.tool_calls
                ],
            )

            if decision.decision_type == DecisionType.FINAL_ANSWER:
                logger.debug("Reasoning final answer: iteration=%s", iteration)
                if len(decision.text) > len(best_text):
                    best_text = decision.text
                if force_tool and not tools_executed and no_tool_rounds < 2:
                    no_tool_rounds += 1
                    trace.system_note = "forced_retry_no_tools"
                    working_messages.append({"role": "assistant", "content": decision.text})
                    working_messages.append(
                        {
                            "role": "user",
                            "content": (
                                "You have not used tools yet. "
                                "If the task requires action, call tools now. "
                                "If the task truly needs no tools, provide a direct complete answer."
                            ),
                        }
                    )
                    self._record_trace(trace)
                    continue
                if tools_executed and not self._looks_grounded(decision.text):
                    if len(decision.text) > len(best_text):
                        best_text = decision.text
                    ungrounded_rounds += 1
                    if ungrounded_rounds >= 3:
                        logger.warning(
                            "Reasoning: accepting best text after %d ungrounded rounds (len=%d)",
                            ungrounded_rounds, len(best_text),
                        )
                        self._record_trace(trace)
                        if best_text:
                            return self._clean_final_answer(best_text.strip())
                        return self._clean_final_answer(decision.text.strip() or "No response generated.")
                    trace.system_note = "final_answer_failed_minimal_verification"
                    self._record_trace(trace)
                    working_messages.append({"role": "assistant", "content": decision.text})
                    working_messages.append(
                        {
                            "role": "user",
                            "content": (
                                "Your final answer is too weak or ungrounded relative to the tool results. "
                                "You must provide the FULL detailed itinerary plan (with daily schedule, transportation, "
                                "hotel recommendations, budget breakdown, etc.) BEFORE asking the user if they are satisfied. "
                                "Do NOT just ask for confirmation without showing the plan first. "
                                "Use the tool results explicitly to build a complete travel plan."
                            ),
                        }
                    )
                    continue
                self._record_trace(trace)
                cleaned = self._clean_final_answer(decision.text.strip() or "No response generated.")
                return cleaned

            no_tool_rounds = 0
            duplicate_round = False
            for call in decision.tool_calls:
                signature = self._make_signature(call)
                seen_signatures[signature] = seen_signatures.get(signature, 0) + 1
                if seen_signatures[signature] >= 3:
                    duplicate_round = True

            if duplicate_round:
                logger.warning("Reasoning duplicate tool call pattern detected")
                trace.system_note = "duplicate_tool_calls_detected"
                self._record_trace(trace)
                working_messages.append({"role": "assistant", "content": decision.text})
                working_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "You are repeating the same tool call pattern. "
                            "Use a different tool, ask the user for missing information, "
                            "or provide the best final answer."
                        ),
                    }
                )
                continue

            if near_limit and decision.tool_calls:
                logger.warning(
                    "Reasoning near iteration limit (%s/%s), forcing final answer",
                    iteration, settings.max_iterations,
                )
                trace.system_note = "forced_final_answer_near_limit"
                self._record_trace(trace)
                working_messages.append({"role": "assistant", "content": decision.text or ""})
                working_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "You are approaching the maximum number of reasoning steps. "
                            "You MUST now provide a complete final answer to the user based on the information you have gathered. "
                            "Do NOT call any more tools. Synthesize all the tool results into a clear, helpful response."
                        ),
                    }
                )
                continue

            tool_results = await self._tool_executor.execute(decision.tool_calls)
            for i, (call, result) in enumerate(zip(decision.tool_calls, tool_results)):
                result_preview = str(result.get("content", ""))[:200]
                is_error = result.get("is_error", False)
                log_level = logging.WARNING if is_error else logging.INFO
                logger.log(
                    log_level,
                    "Tool result [%s]: name=%s args=%s error=%s result=%s",
                    i + 1,
                    call.name,
                    json.dumps(call.arguments, ensure_ascii=False)[:200],
                    is_error,
                    result_preview,
                )
            tools_executed = True
            trace.tool_results = tool_results
            self._record_trace(trace)

            confirmation_required = [result for result in tool_results if result.get("requires_confirmation")]
            if confirmation_required:
                first = confirmation_required[0]
                question = str(first.get("content") or "Confirmation required.")
                logger.info("Reasoning paused for confirmation: %s", question)
                raise ConfirmationNeeded(question)

            for result in tool_results:
                if result.get("ask_user"):
                    if iteration == 1 and not tools_executed:
                        logger.info(
                            "ask_user called on first iteration without any search tools - suppressing and redirecting to search tools"
                        )
                        trace.system_note = "ask_user_suppressed_first_iteration"
                        self._record_trace(trace)
                        working_messages.append({"role": "assistant", "content": decision.text})
                        working_messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "The user has already provided sufficient information in their message. "
                                    "Do NOT call ask_user again. Instead, proceed directly with the available search tools "
                                    "(fliggy_search_flight, fliggy_search_train, fliggy_search_hotel, amap_search_poi, amap_get_weather, etc.) "
                                    "to gather real data and generate a travel plan. "
                                    "If some minor details are missing, make reasonable assumptions and proceed."
                                ),
                            }
                        )
                        continue
                    logger.info("Reasoning interrupted for ask_user")
                    raise AskUserNeeded(str(result.get("question") or result.get("content") or ""))

            if use_native:
                assistant_msg: dict[str, Any] = {"role": "assistant", "content": decision.text or None}
                assistant_msg["tool_calls"] = [
                    {
                        "id": call.call_id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": json.dumps(call.arguments, ensure_ascii=False),
                        },
                    }
                    for call in decision.tool_calls
                ]
                working_messages.append(assistant_msg)
                for call, result in zip(decision.tool_calls, tool_results):
                    tool_content = result.get("content", "")
                    if isinstance(tool_content, dict):
                        tool_content = json.dumps(tool_content, ensure_ascii=False)
                    working_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.call_id,
                            "content": str(tool_content)[:4000],
                        }
                    )
                working_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Use the tool results above to continue. "
                            "If they are sufficient, reply with a plain-text final answer for the user. "
                            "Only call new tools if you still need different information. "
                            "Do not repeat the same tool calls."
                        ),
                    }
                )
            else:
                assistant_payload = {
                    "tool_calls": trace.tool_calls,
                    "text": decision.text,
                }
                working_messages.append(
                    {"role": "assistant", "content": json.dumps(assistant_payload, ensure_ascii=False)}
                )
                result_summaries = []
                for r in tool_results:
                    name = r.get("name", "unknown")
                    content = r.get("content", "")
                    is_error = r.get("is_error", False)
                    tag = "ERROR" if is_error else "OK"
                    result_summaries.append(f"[{name}] {tag}: {content[:2000]}")
                working_messages.append(
                    {
                        "role": "user",
                        "content": "Tool results:\n" + "\n---\n".join(result_summaries),
                    }
                )
                if all(
                    not result.get("is_error", False) and not result.get("requires_confirmation")
                    for result in tool_results
                ):
                    working_messages.append(
                        {
                            "role": "user",
                            "content": (
                                "Use the tool results above to continue. "
                                "If they are sufficient, reply with a plain-text final answer for the user. "
                                "Only return new tool_calls JSON if you still need different information or a different action. "
                                "Do not repeat the same tool_calls JSON."
                            ),
                        }
                    )
                else:
                    working_messages.append(
                        {
                            "role": "user",
                            "content": (
                                "The tool results contain errors, missing data, or confirmation requests. "
                                "If you can recover, call a different tool or ask the user for the missing information. "
                                "If the results are already sufficient, answer plainly. "
                                "Do not repeat the same tool_calls JSON."
                            ),
                        }
                    )

        logger.warning("Reasoning stopped after max iterations")
        if best_text:
            logger.info("Reasoning: returning best collected text (len=%d)", len(best_text))
            return self._clean_final_answer(best_text.strip())
        return "Stopped after reaching the maximum iteration limit."

    @staticmethod
    def _looks_grounded(text: str) -> bool:
        clean = text.strip()
        if len(clean) < 12:
            return False
        weak_patterns = (
            "done",
            "finished",
            "completed",
            "ok",
            "tool ok",
            "task complete",
        )
        lowered = clean.lower()
        if lowered in weak_patterns:
            return False
        confirmation_only_patterns = (
            "您对这个行程满意吗",
            "满意的话我将为您生成",
            "不满意可以告诉我",
            "是否满意",
        )
        has_confirmation_only = any(p in clean for p in confirmation_only_patterns)
        if has_confirmation_only:
            content_markers = (
                "第1天", "第一天", "Day 1", "行程安排", "每日行程",
                "交通", "住宿", "景点", "预算", "推荐",
                "高铁", "机票", "酒店", "元",
            )
            has_real_content = any(m in clean for m in content_markers)
            if not has_real_content:
                return False
        return True

    @staticmethod
    def _make_signature(call: ToolCall) -> str:
        try:
            args = json.dumps(call.arguments, sort_keys=True, ensure_ascii=False)
        except Exception:
            args = str(call.arguments)
        return f"{call.name}:{args}"

    @staticmethod
    def _clean_final_answer(text: str) -> str:
        cleaned = text.strip()
        cleaned = _strip_code_fences(cleaned)
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict):
                if "tool_calls" in data or "tool_results" in data or "text" in data:
                    text_only = str(data.get("text", "")).strip()
                    if text_only:
                        return ReasoningEngine._strip_reasoning_prefix(text_only)
                    cleaned = ""
        except (json.JSONDecodeError, ValueError):
            pass
        if '"text"' in cleaned and ('"tool_calls"' in cleaned or '"tool_results"' in cleaned or '"arguments"' in cleaned):
            text_match = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', cleaned)
            if text_match:
                extracted = text_match.group(1)
                try:
                    extracted = json.loads('"' + extracted + '"')
                except Exception:
                    pass
                if extracted.strip():
                    return ReasoningEngine._strip_reasoning_prefix(extracted.strip())
        if '"tool_results"' in cleaned:
            text_match = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', cleaned)
            if text_match:
                extracted = text_match.group(1)
                try:
                    extracted = json.loads('"' + extracted + '"')
                except Exception:
                    pass
                if extracted.strip():
                    return ReasoningEngine._strip_reasoning_prefix(extracted.strip())
            cleaned = re.sub(r'\{[^{}]*"tool_results"\s*:\s*\[.*?\][^{}]*\}', '', cleaned, flags=re.DOTALL)
        cleaned = re.sub(
            r'\{[^{}]*"tool_calls"\s*:\s*\[[^\]]*\][^{}]*\}',
            '',
            cleaned,
            flags=re.DOTALL,
        )
        cleaned = re.sub(
            r'["\']tool_calls["\']\s*:\s*\[[^\]]*\]\s*,?',
            '',
            cleaned,
            flags=re.DOTALL,
        )
        cleaned = re.sub(
            r'\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}',
            '',
            cleaned,
            flags=re.DOTALL,
        )
        cleaned = re.sub(
            r'tool_calls["\']?\s*:\s*\[[^\]]*\]',
            '',
            cleaned,
            flags=re.DOTALL,
        )
        xml_pattern = r'<tool_call[^>]*>.*?</tool_call'
        cleaned = re.sub(xml_pattern + '>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
        cleaned = ReasoningEngine._strip_reasoning_prefix(cleaned)
        return cleaned.strip()

    _REASONING_PATTERNS = [
        r'(?:Now|So)\s+I\s+have\s+enough\s+information.*?(?=\n)',
        r'Let\s+me\s+(?:now\s+)?(?:compile|save|create|generate|summarize|put|write|provide).*?(?=\n)',
        r'Key\s+findings?\s*:\s*',
        r'I\s+will\s+now\s+.*?(?=\n)',
        r'Let(?:\'s| us)\s+(?:now\s+)?(?:proceed|move|start|begin|compile|create|generate|save|put|write).*?(?=\n)',
        r'Based\s+on\s+(?:the\s+)?(?:above|these|tool|search|following)\s+(?:results?|data|information|findings).*?(?=\n)',
        r'With\s+(?:all\s+)?(?:the\s+)?(?:above|these|tool)\s+(?:results?|data|information).*?(?=\n)',
    ]

    @staticmethod
    def _strip_reasoning_prefix(text: str) -> str:
        lines = text.split('\n')
        result_lines = []
        for line in lines:
            stripped = line.strip()
            is_reasoning = False
            for pattern in ReasoningEngine._REASONING_PATTERNS:
                if re.match(pattern, stripped, re.IGNORECASE):
                    is_reasoning = True
                    break
            if not is_reasoning:
                result_lines.append(line)
        cleaned = '\n'.join(result_lines)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
        return cleaned.strip()

    @staticmethod
    def _strip_tool_calls_from_text(text: str) -> str:
        cleaned = ReasoningEngine._clean_final_answer(text)
        cleaned = re.sub(r'\{[\s\S]*?"tool_calls"[\s\S]*?\}', '', cleaned)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
        return cleaned.strip()

    def _parse_decision(self, text: str) -> Decision:
        stripped = text.strip()
        try:
            data = _extract_json_object(stripped)
        except Exception:
            xml_result = self._try_parse_xml_tool_calls(stripped)
            if xml_result:
                return xml_result
            regex_result = self._try_parse_regex_tool_calls(stripped)
            if regex_result:
                return regex_result
            loose_result = self._try_loose_tool_call_parse(stripped)
            if loose_result:
                return loose_result
            safe_text = self._clean_final_answer(stripped)
            return Decision(decision_type=DecisionType.FINAL_ANSWER, text=safe_text or stripped)

        raw_calls = data.get("tool_calls")
        if not raw_calls:
            plain_text = str(data.get("text", "")).strip()
            xml_result = self._try_parse_xml_tool_calls(plain_text)
            if xml_result:
                return xml_result
            return Decision(
                decision_type=DecisionType.FINAL_ANSWER,
                text=plain_text,
                raw=data,
            )

        tool_calls = [
            ToolCall(
                name=str(item["name"]),
                arguments=dict(item.get("arguments") or item.get("args") or {}),
                call_id=str(item.get("id", uuid.uuid4())),
            )
            for item in raw_calls
        ]
        clean_text = ReasoningEngine._strip_tool_calls_from_text(str(data.get("text", "")))
        return Decision(
            decision_type=DecisionType.TOOL_CALLS,
            text=clean_text,
            tool_calls=tool_calls,
            raw=data,
        )

    def _try_loose_tool_call_parse(self, text: str) -> Decision | None:
        if '"tool_calls"' not in text:
            return None
        json_str = _extract_json_by_brackets(text)
        if not json_str:
            return None
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            fixed = self._try_fix_json(json_str)
            if fixed:
                try:
                    data = json.loads(fixed)
                except json.JSONDecodeError:
                    return None
            else:
                return None
        if not isinstance(data, dict):
            return None
        raw_calls = data.get("tool_calls")
        if not raw_calls or not isinstance(raw_calls, list):
            return None
        tool_calls = []
        for item in raw_calls:
            if not isinstance(item, dict) or "name" not in item:
                continue
            tool_calls.append(ToolCall(
                name=str(item["name"]),
                arguments=dict(item.get("arguments") or item.get("args") or {}),
                call_id=str(item.get("id", uuid.uuid4())),
            ))
        if not tool_calls:
            return None
        clean_text = ReasoningEngine._strip_tool_calls_from_text(str(data.get("text", "")))
        return Decision(
            decision_type=DecisionType.TOOL_CALLS,
            text=clean_text,
            tool_calls=tool_calls,
            raw=data,
        )

    @staticmethod
    def _try_fix_json(text: str) -> str | None:
        if not text:
            return None
        fixed = text.rstrip()
        if not fixed.endswith("}"):
            depth = 0
            in_string = False
            escape = False
            for c in fixed:
                if escape:
                    escape = False
                    continue
                if c == "\\" and in_string:
                    escape = True
                    continue
                if c == '"' and not escape:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
            if in_string:
                fixed += '"'
            for _ in range(max(0, depth)):
                fixed += "}"
        return fixed

    _TOOL_CALL_ITEM_RE = re.compile(
        r'\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|args)"\s*:\s*(\{[^}]*\})\s*\}',
        re.DOTALL,
    )

    def _try_parse_regex_tool_calls(self, text: str) -> Decision | None:
        if '"tool_calls"' not in text and '"name"' not in text:
            return None
        items = list(self._TOOL_CALL_ITEM_RE.finditer(text))
        if not items:
            return None
        calls: list[ToolCall] = []
        for match in items:
            name = match.group(1)
            args_str = match.group(2)
            try:
                arguments = json.loads(args_str)
            except (json.JSONDecodeError, ValueError):
                arguments = self._parse_kwargs(args_str)
            if not isinstance(arguments, dict):
                arguments = {}
            calls.append(ToolCall(name=name, arguments=arguments, call_id=str(uuid.uuid4())))
        if not calls:
            return None
        plain_text = self._TOOL_CALL_ITEM_RE.sub("", text)
        plain_text = re.sub(r'["\']tool_calls["\']\s*:\s*\[[\s\S]*?\]', '', plain_text)
        plain_text = re.sub(r'\{[\s\S]*?["\']tool_calls["\'][\s\S]*\}', '', plain_text)
        plain_text = re.sub(r'tool_calls["\']?\s*:\s*\[[\s\S]*?\]', '', plain_text)
        plain_text = re.sub(r'\n{3,}', '\n\n', plain_text).strip()
        return Decision(
            decision_type=DecisionType.TOOL_CALLS,
            text=plain_text,
            tool_calls=calls,
        )

    _XML_TOOL_RE = re.compile(
        r'<tool_call[^>]*>\s*\n?(.*?)(?:</tool_call|(?=<tool_call)|$)',
        re.DOTALL | re.IGNORECASE,
    )

    def _try_parse_xml_tool_calls(self, text: str) -> Decision | None:
        calls: list[ToolCall] = []
        for match in self._XML_TOOL_RE.finditer(text):
            inner = match.group(1).strip()
            parsed = self._parse_xml_func_call(inner)
            if parsed:
                calls.append(parsed)
        if not calls:
            return None
        plain_text = self._XML_TOOL_RE.sub("", text).strip()
        plain_text = re.sub(r'\n{3,}', '\n\n', plain_text)
        return Decision(
            decision_type=DecisionType.TOOL_CALLS,
            text=plain_text,
            tool_calls=calls,
        )

    def _parse_xml_func_call(self, inner: str) -> ToolCall | None:
        inner = inner.strip()
        match = re.match(r'\s*([a-zA-Z_][a-zA-Z_0-9]*)\s*\((.*)\)\s*$', inner, re.DOTALL)
        if not match:
            return None
        name = match.group(1)
        args_str = match.group(2)
        args = self._parse_kwargs(args_str)
        if self._tool_registry.has(name):
            return ToolCall(name=name, arguments=args, call_id=str(uuid.uuid4()))
        if name.startswith(('fliggy_', 'amap_', 'save_')):
            return ToolCall(name=name, arguments=args, call_id=str(uuid.uuid4()))
        return None

    @staticmethod
    def _parse_kwargs(args_str: str) -> dict[str, str]:
        result: dict[str, str] = {}
        for match in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', args_str):
            result[match.group(1)] = match.group(2)
        for match in re.finditer(r"(\w+)\s*=\s*'([^']*)'", args_str):
            if match.group(1) not in result:
                result[match.group(1)] = match.group(2)
        return result
