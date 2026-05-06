from ho_sdk.attributes import GenAIAttributes, HoAttributes


def test_gen_ai_attributes():
    assert GenAIAttributes.SYSTEM == "gen_ai.system"
    assert GenAIAttributes.REQUEST_MODEL == "gen_ai.request.model"
    assert GenAIAttributes.USAGE_INPUT_TOKENS == "gen_ai.usage.input_tokens"
    assert GenAIAttributes.USAGE_OUTPUT_TOKENS == "gen_ai.usage.output_tokens"
    assert GenAIAttributes.TOOL_NAME == "gen_ai.tool.name"


def test_ho_attributes():
    assert HoAttributes.SESSION_ID == "ho.session.id"
    assert HoAttributes.COST_USD == "ho.cost.usd"
    assert HoAttributes.CONTEXT_ROT_TYPE == "ho.context_rot.type"
    assert HoAttributes.ALERT_FIRED == "ho.alert.fired"
