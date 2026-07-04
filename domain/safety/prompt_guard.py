"""Prompt 注入防御 — 用户消息进入 LLM 前的基础消毒层。

社区版做基础防御（正则匹配），聊胜于无。不引入第三方 NLP 依赖。
"""

import re
import logging

logger = logging.getLogger(__name__)

# 常见的 Prompt 注入模式
_INJECTION_PATTERNS = [
    (r"ignore\s+(previous|above|all)\s+instructions", "忽略指令注入"),
    (r"forget\s+(your|the)\s+(system|previous)\s+prompt", "忘记系统提示注入"),
    (r"you\s+are\s+now\s+(a|an)\s+", "角色劫持"),
    (r"</(system|assistant)>", "标签注入"),
    (r"system\s*:\s*", "系统标签注入"),
    (r"\[INST\].*\[/INST\]", "Llama 指令注入"),
    (r"<\|im_start\|>|<\|im_end\|>", "ChatML 分隔符注入"),
]


class PromptGuard:
    """输入消毒层 — 在用户消息进入 LLM 前过滤。

    用法：
        guard = PromptGuard()
        cleaned, warnings = guard.sanitize(user_message)
        if warnings:
            logger.warning("Prompt injection detected: %s", warnings)
    """

    @staticmethod
    def sanitize(message: str) -> "tuple[str, list[str]]":
        """返回消毒后的消息 + 触发的警告列表。

        注意：不直接拦截消息（可能误杀正常内容），而是标记警告供上层决策。
        """
        warnings: list[str] = []
        cleaned = message.strip()

        for pattern, label in _INJECTION_PATTERNS:
            if re.search(pattern, cleaned, re.IGNORECASE):
                warnings.append(f"{label}: {pattern}")

        # 长度异常检测（超长单消息可能包含注入载荷）
        if len(cleaned) > 32000:
            warnings.append("消息过长(>32K字符)，可能存在注入载荷")
            cleaned = cleaned[:32000]

        return cleaned, warnings

    @staticmethod
    def is_suspicious(message: str) -> bool:
        """快速判断是否可疑（用于日志标记，不拦截）。"""
        _, warnings = PromptGuard.sanitize(message)
        return len(warnings) > 0
