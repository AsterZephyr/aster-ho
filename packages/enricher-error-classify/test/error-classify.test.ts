import { GenAIAttributes, HoAttributes } from "@ho/sdk";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { ErrorClassifyEnricher, computeFingerprint } from "../src/index.js";

function mockSpan(
	statusCode: number,
	message?: string,
	attributes: Record<string, string> = {},
): ReadableSpan {
	return {
		status: { code: statusCode, message },
		attributes,
		spanContext: () => ({ traceId: "abc123trace", spanId: "def456span", traceFlags: 0 }),
	} as unknown as ReadableSpan;
}

describe("ErrorClassifyEnricher", () => {
	const enricher = new ErrorClassifyEnricher();

	it("skips non-error spans", () => {
		const span = mockSpan(SpanStatusCode.OK);
		const result = enricher.enrich(span, { existing: "attr" });
		expect(result[HoAttributes.ERROR_CATEGORY]).toBeUndefined();
		expect(result.existing).toBe("attr");
	});

	it("classifies rate limit errors as provider_error", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "Error 429: rate limit exceeded");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("provider_error");
	});

	it("classifies JSON parse errors as invalid_arguments", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "json parse error at position 5");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("invalid_arguments");
	});

	it("classifies timeout errors", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "Request timed out after 30s");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("timeout");
	});

	it("classifies cancelled/aborted errors", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "Request was cancelled by user");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("user_aborted");
	});

	it("classifies context overflow errors", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "context length exceeded: max 128k tokens");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("context_overflow");
	});

	it("returns unknown for unrecognized errors", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "something weird happened");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("unknown");
	});

	it("supports custom rules with higher priority", () => {
		const custom = new ErrorClassifyEnricher({
			customRules: [{ pattern: /custom_error/i, category: "my_category" }],
		});
		const span = mockSpan(SpanStatusCode.ERROR, "custom_error occurred");
		const result = custom.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("my_category");
	});

	it("handles empty error message", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("unknown");
	});
});

describe("New error categories", () => {
	const enricher = new ErrorClassifyEnricher();

	it("classifies auth_error (401)", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "HTTP 401 Unauthorized");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("auth_error");
	});

	it("classifies auth_error (invalid api key)", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "Invalid API key provided");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("auth_error");
	});

	it("classifies network_error (ECONNREFUSED)", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "connect ECONNREFUSED 127.0.0.1:3000");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("network_error");
	});

	it("classifies network_error (socket hang up)", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "socket hang up");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("network_error");
	});

	it("classifies content_filter", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "Response blocked by content policy");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("content_filter");
	});

	it("classifies tool_not_found", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "tool not found: search_web");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("tool_not_found");
	});

	it("classifies tool_execution_error", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "tool execution failed: TypeError");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("tool_execution_error");
	});

	it("classifies schema_mismatch", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "schema validation failed for response");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("schema_mismatch");
	});

	it("classifies quota_exceeded", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "quota exceeded, please upgrade");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("quota_exceeded");
	});

	it("classifies model_not_available", () => {
		const span = mockSpan(SpanStatusCode.ERROR, "model not found: gpt-5-turbo");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_CATEGORY]).toBe("model_not_available");
	});
});

describe("Fingerprint", () => {
	it("produces stable hash for same pattern with different numbers", () => {
		const fp1 = computeFingerprint("Error at line 42, column 7");
		const fp2 = computeFingerprint("Error at line 99, column 12");
		expect(fp1).toBe(fp2);
	});

	it("produces stable hash for same pattern with different UUIDs", () => {
		const fp1 = computeFingerprint("Request abc12345-1234-1234-1234-123456789abc failed");
		const fp2 = computeFingerprint("Request def98765-5678-5678-5678-987654321def failed");
		expect(fp1).toBe(fp2);
	});

	it("produces stable hash for same pattern with different paths", () => {
		const fp1 = computeFingerprint("File not found: /usr/local/lib/foo.so");
		const fp2 = computeFingerprint("File not found: /home/user/bar.dll");
		expect(fp1).toBe(fp2);
	});

	it("produces different hashes for structurally different messages", () => {
		const fp1 = computeFingerprint("connection refused");
		const fp2 = computeFingerprint("timeout exceeded");
		expect(fp1).not.toBe(fp2);
	});

	it("ho.error.fingerprint is always set on error spans", () => {
		const enricher = new ErrorClassifyEnricher();
		const span = mockSpan(SpanStatusCode.ERROR, "some error");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_FINGERPRINT]).toBeDefined();
		expect(typeof result[HoAttributes.ERROR_FINGERPRINT]).toBe("string");
		expect((result[HoAttributes.ERROR_FINGERPRINT] as string).length).toBeGreaterThan(0);
	});
});

describe("ho.error.model_tool attribute", () => {
	it("formats as model:tool from span attributes", () => {
		const enricher = new ErrorClassifyEnricher();
		const span = mockSpan(SpanStatusCode.ERROR, "some error", {
			[GenAIAttributes.REQUEST_MODEL]: "gpt-4",
			[GenAIAttributes.TOOL_NAME]: "search_web",
		});
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_MODEL_TOOL]).toBe("gpt-4:search_web");
	});

	it("handles missing model and tool gracefully", () => {
		const enricher = new ErrorClassifyEnricher();
		const span = mockSpan(SpanStatusCode.ERROR, "some error");
		const result = enricher.enrich(span, {});
		expect(result[HoAttributes.ERROR_MODEL_TOOL]).toBe(":");
	});
});

describe("unknownCallback", () => {
	it("fires when category is unknown", () => {
		const callback = vi.fn();
		const enricher = new ErrorClassifyEnricher({ unknownCallback: callback });
		const span = mockSpan(SpanStatusCode.ERROR, "totally bizarre failure", {
			[GenAIAttributes.REQUEST_MODEL]: "claude-3",
			[GenAIAttributes.TOOL_NAME]: "code_exec",
		});

		enricher.enrich(span, {});

		expect(callback).toHaveBeenCalledOnce();
		const entry = callback.mock.calls[0][0];
		expect(entry.fingerprint).toBeDefined();
		expect(entry.message).toBe("totally bizarre failure");
		expect(entry.traceId).toBe("abc123trace");
		expect(entry.model).toBe("claude-3");
		expect(entry.tool).toBe("code_exec");
		expect(entry.timestamp).toBeGreaterThan(0);
	});

	it("does not fire when category is known", () => {
		const callback = vi.fn();
		const enricher = new ErrorClassifyEnricher({ unknownCallback: callback });
		const span = mockSpan(SpanStatusCode.ERROR, "Request timed out after 30s");

		enricher.enrich(span, {});

		expect(callback).not.toHaveBeenCalled();
	});

	it("does not fire when no callback configured", () => {
		const enricher = new ErrorClassifyEnricher();
		const span = mockSpan(SpanStatusCode.ERROR, "totally bizarre failure");
		// Should not throw
		expect(() => enricher.enrich(span, {})).not.toThrow();
	});
});
