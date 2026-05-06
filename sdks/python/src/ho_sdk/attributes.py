"""Semantic convention attribute constants for ho SDK.

Mirrors packages/sdk/src/types.ts to prevent drift.
"""


class GenAIAttributes:
    SYSTEM = "gen_ai.system"
    REQUEST_MODEL = "gen_ai.request.model"
    REQUEST_TEMPERATURE = "gen_ai.request.temperature"
    REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
    REQUEST_TOP_P = "gen_ai.request.top_p"
    RESPONSE_MODEL = "gen_ai.response.model"
    RESPONSE_FINISH_REASON = "gen_ai.response.finish_reasons"
    USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
    USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
    TOOL_NAME = "gen_ai.tool.name"
    TOOL_CALL_ID = "gen_ai.tool.call_id"
    PROMPT = "gen_ai.prompt"
    COMPLETION = "gen_ai.completion"


class HoAttributes:
    SESSION_ID = "ho.session.id"
    TURN_INDEX = "ho.turn.index"
    COST_USD = "ho.cost.usd"
    CONTEXT_ROT_TYPE = "ho.context_rot.type"
    CONTEXT_ROT_TOKEN_RATIO = "ho.context_rot.token_ratio"
    CONTEXT_ROT_CASCADE_DEPTH = "ho.context_rot.cascade_depth"
    ALERT_FIRED = "ho.alert.fired"
    ALERT_RULE = "ho.alert.rule"
