"""OpenAI-shape bridge shared by Lemon AI' ACP clients.

ACP has no OpenAI-style ``tools``/``tool_calls`` channel, so Lemon AI' tool schemas travel INTO the
prompt as text (:func:`render_tool_bridge_sections`) and calls are parsed back OUT of the response
text (:func:`extract_tool_calls_from_text`). Clients differ only in WHICH tools they forward
(``allowlist``): a CLI with no tools of its own forwards everything; an autonomous agent with its own
read/edit/execute tools forwards only Lemon AI' agent-level tools, since re-offering overlapping ones
makes Lemon AI redo finished work.
"""

from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import Any, Iterable

from openai.types.chat.chat_completion_message_tool_call import ChatCompletionMessageToolCall, Function

# Historical wire-shape detectors (kept on the public module). Extraction scans
# complete JSON objects with ``json.JSONDecoder.raw_decode`` instead of these —
# non-greedy ``{.*?}`` is not a JSON grammar and truncates nested objects.
TOOL_CALL_BLOCK_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
TOOL_CALL_JSON_RE = re.compile(
    r"\{\s*\"id\"\s*:\s*\"[^\"]+\"\s*,\s*\"type\"\s*:\s*\"function\"\s*,\s*\"function\"\s*:\s*\{.*?\}\s*\}", re.DOTALL
)
_TOOL_CALL_OPEN = "<tool_call>"
_TOOL_CALL_CLOSE = "</tool_call>"
_JSON_DECODER = json.JSONDecoder()
_JSON_WS = " \t\r\n"

TOOL_CALL_CONTRACT = (
    "Available tools (OpenAI function schema). "
    "When using a tool, emit ONLY <tool_call>{...}</tool_call> with one JSON object "
    "containing id/type/function{name,arguments}. arguments must be a JSON string."
)

__all__ = [
    "TOOL_CALL_BLOCK_RE", "TOOL_CALL_JSON_RE", "TOOL_CALL_CONTRACT", "StreamChunks", "build_openai_tool_call",
    "tool_specs_from_openai_tools", "render_tool_bridge_sections", "extract_tool_calls_from_text",
    "completion_to_stream_chunks",
]


class StreamChunks(list):
    """Chunk list that also carries response-level attributes (e.g. ``lemon_projected_messages``)
    Lemon AI reads off the ``create`` result; a plain list would drop them on the stream path."""


def completion_to_stream_chunks(completion: SimpleNamespace) -> StreamChunks:
    """Re-shape a one-shot ACP response as OpenAI stream chunks (data chunk + usage chunk); response-level
    attributes other than choices/usage/model are copied onto the result."""
    choice = completion.choices[0]
    message = choice.message
    tool_call_deltas = None
    if message.tool_calls:
        tool_call_deltas = [
            SimpleNamespace(
                index=index, id=getattr(tool_call, "id", None), type=getattr(tool_call, "type", "function"),
                function=SimpleNamespace(name=getattr(tool_call.function, "name", None),
                                         arguments=getattr(tool_call.function, "arguments", None)),
            )
            for index, tool_call in enumerate(message.tool_calls)
        ]
    delta = SimpleNamespace(
        role="assistant", content=message.content or None, tool_calls=tool_call_deltas,
        reasoning_content=getattr(message, "reasoning_content", None), reasoning=getattr(message, "reasoning", None),
    )
    data_chunk = SimpleNamespace(
        choices=[SimpleNamespace(index=0, delta=delta, finish_reason=choice.finish_reason)],
        model=completion.model, usage=None,
    )
    usage_chunk = SimpleNamespace(choices=[], model=completion.model, usage=completion.usage)
    chunks = StreamChunks([data_chunk, usage_chunk])
    for key, value in vars(completion).items():
        if key not in ("choices", "usage", "model"):
            setattr(chunks, key, value)
    return chunks


def build_openai_tool_call(*, call_id: str, name: str, arguments: str) -> ChatCompletionMessageToolCall:
    """Build an OpenAI-compatible tool-call object for downstream handling."""
    return ChatCompletionMessageToolCall(
        id=call_id, call_id=call_id, response_item_id=None, type="function",
        function=Function(name=name, arguments=arguments),
    )


def _named_function(container: Any) -> tuple[dict[str, Any], str] | None:
    """``(fn, stripped name)`` from ``container["function"]`` when it is a dict with a non-blank name, else None."""
    fn = container.get("function") if isinstance(container, dict) else None
    name = fn.get("name") if isinstance(fn, dict) else None
    return (fn, name.strip()) if isinstance(name, str) and name.strip() else None


def tool_specs_from_openai_tools(
    tools: list[dict[str, Any]] | None, *, allowlist: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Flatten OpenAI ``tools`` into ``{name, description, parameters}`` specs; malformed entries are skipped."""
    allowed = {str(n).strip() for n in allowlist} if allowlist is not None else None
    specs: list[dict[str, Any]] = []
    for t in tools or []:
        named = _named_function(t)
        if named is None or (allowed is not None and named[1] not in allowed):
            continue
        fn, name = named
        specs.append({"name": name, "description": fn.get("description", ""), "parameters": fn.get("parameters", {})})
    return specs


def render_tool_bridge_sections(
    tools: list[dict[str, Any]] | None, tool_choice: Any = None, *, allowlist: Iterable[str] | None = None,
) -> list[str]:
    """Prompt sections carrying the forwarded tool schemas + choice hint (empty list when neither applies)."""
    specs = tool_specs_from_openai_tools(tools, allowlist=allowlist)
    sections: list[str] = []
    if specs:
        sections.append(TOOL_CALL_CONTRACT + "\n" + json.dumps(specs, ensure_ascii=False))
    if tool_choice is not None:
        sections.append(f"Tool choice hint: {json.dumps(tool_choice, ensure_ascii=False)}")
    return sections


def _skip_ws(text: str, idx: int, limit: int | None = None) -> int:
    """First non-whitespace index in ``text[idx:limit]`` (``limit`` defaults to ``len(text)``)."""
    end = len(text) if limit is None else limit
    while idx < end and text[idx] in _JSON_WS:
        idx += 1
    return idx


def _raw_object(text: str, idx: int) -> tuple[Any, int] | None:
    """One JSON object at ``idx`` (leading whitespace allowed) → ``(value, end)``, else None."""
    try:
        value, end = _JSON_DECODER.raw_decode(text, idx)
    except json.JSONDecodeError:
        return None
    return (value, end) if isinstance(value, dict) else None


def _object_ending_at(text: str, start: int, limit: int) -> Any | None:
    """First JSON object in ``text[start:limit]`` followed only by whitespace until ``limit``."""
    idx = start
    while idx < limit:
        if text[idx] == "{":
            decoded = _raw_object(text, idx)
            if decoded is not None:
                value, end = decoded
                if end <= limit and _skip_ws(text, end, limit) == limit:
                    return value
                idx = end
                continue
        idx += 1
    return None


def _tool_call_from_obj(obj: Any, ordinal: int) -> ChatCompletionMessageToolCall | None:
    """OpenAI-shaped dict → tool call, or None. Missing id → ``acp_call_<ordinal>``."""
    named = _named_function(obj)
    if named is None:
        return None
    fn, fn_name = named
    fn_args = fn.get("arguments", "{}")
    if not isinstance(fn_args, str):
        fn_args = json.dumps(fn_args, ensure_ascii=False)
    call_id = obj.get("id") if isinstance(obj, dict) else None
    if not isinstance(call_id, str) or not call_id.strip():
        call_id = f"acp_call_{ordinal}"
    return build_openai_tool_call(call_id=call_id, name=fn_name, arguments=fn_args)


def _bare_tool_call_shape(obj: Any) -> bool:
    """Bare JSON is not wrapped in ``<tool_call>``, so require an OpenAI-ish type or id
    in addition to a named function. Key order does not matter (unlike the legacy regex).
    Shape is necessary, not sufficient: ``extract_tool_calls_from_text`` still rejects
    objects that leave leftover prose (examples, not calls)."""
    if _named_function(obj) is None:
        return False
    typ = obj.get("type") if isinstance(obj, dict) else None
    if typ is not None and typ != "function":
        return False
    if typ == "function":
        return True
    ident = obj.get("id") if isinstance(obj, dict) else None
    return isinstance(ident, str) and bool(ident.strip())


def _parse_tool_call(raw_json: str, ordinal: int) -> ChatCompletionMessageToolCall | None:
    """One ``<tool_call>`` JSON body → tool call, or None when malformed. Missing id → ``acp_call_<ordinal>``."""
    try:
        obj = json.loads(raw_json)
    except Exception:
        return None
    return _tool_call_from_obj(obj, ordinal)


def _strip_consumed(text: str, spans: list[tuple[int, int]]) -> str:
    """Remove merged ``[start, end)`` spans and squeeze leftover prose."""
    spans = sorted(spans)
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    parts: list[str] = []
    cursor = 0
    for start, end in merged:
        if cursor < start:
            parts.append(text[cursor:start])
        cursor = max(cursor, end)
    if cursor < len(text):
        parts.append(text[cursor:])
    return "\n".join(p.strip() for p in parts if p and p.strip()).strip()


def extract_tool_calls_from_text(text: str) -> tuple[list[ChatCompletionMessageToolCall], str]:
    """Pull tool calls out of an ACP response → ``(tool_calls, cleaned_text)``.

    Candidates are ``<tool_call>`` wrappers, then (only if none parsed) complete JSON
    objects. Each candidate is ``raw_decode``'d and shape-checked; non-greedy regex is
    not the grammar. Bare objects additionally must cover the message: leftover prose
    after stripping them means an example, not a call. Consumed spans are stripped so
    the assistant message doesn't show raw JSON. Malformed ``<tool_call>{...}</tool_call>``
    wrappers are still stripped.
    """
    if not isinstance(text, str) or not text.strip():
        return [], ""
    extracted: list[ChatCompletionMessageToolCall] = []
    consumed: list[tuple[int, int]] = []
    open_len, close_len = len(_TOOL_CALL_OPEN), len(_TOOL_CALL_CLOSE)
    pos, n = 0, len(text)
    while True:
        start = text.find(_TOOL_CALL_OPEN, pos)
        if start < 0:
            break
        body = start + open_len
        close = text.find(_TOOL_CALL_CLOSE, body)
        if close < 0:
            break
        span_end = close + close_len
        obj = _object_ending_at(text, body, close)
        body_start = _skip_ws(text, body, close)
        if obj is not None:
            call = _tool_call_from_obj(obj, len(extracted) + 1)
            if call is not None:
                extracted.append(call)
            consumed.append((start, span_end))
        elif body_start < close and text[body_start] == "{":
            # ``{not json}`` and similar: not a JSON object, but still a wrapper to strip.
            consumed.append((start, span_end))
        pos = span_end
    if not extracted:
        bare_extracted: list[ChatCompletionMessageToolCall] = []
        bare_consumed: list[tuple[int, int]] = []
        idx = 0
        while idx < n:
            if text[idx] == "{":
                decoded = _raw_object(text, idx)
                if decoded is not None:
                    value, end = decoded
                    if _bare_tool_call_shape(value):
                        call = _tool_call_from_obj(value, len(bare_extracted) + 1)
                        if call is not None:
                            bare_extracted.append(call)
                            bare_consumed.append((idx, end))
                    idx = end
                    continue
            idx += 1
        # Well-formed example JSON still parses; leftover prose is the gate, not
        # an English "do not run" blacklist. Wrappers already consumed (malformed
        # ``<tool_call>``) count as empty leftover.
        if bare_extracted and not _strip_consumed(text, consumed + bare_consumed):
            extracted = bare_extracted
            consumed = consumed + bare_consumed
    if not consumed:
        return extracted, text.strip()
    return extracted, _strip_consumed(text, consumed)
