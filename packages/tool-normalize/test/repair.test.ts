import { describe, expect, it } from "vitest";
import {
	doubleSerializedJson,
	emptyToEmptyObject,
	markdownWrappedJson,
	repairAndParse,
	singleQuotedJson,
	trailingCommaJson,
} from "../src/repair.js";

describe("repairAndParse", () => {
	it("parses valid JSON directly", () => {
		const result = repairAndParse('{"name": "test", "value": 42}');
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ name: "test", value: 42 });
		expect(result.repaired).toBe(false);
	});

	it("returns failure for completely invalid input", () => {
		const result = repairAndParse("not json at all");
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("rejects arrays (only objects accepted)", () => {
		const result = repairAndParse('[1, 2, 3]');
		expect(result.success).toBe(false);
	});
});

describe("doubleSerializedJson", () => {
	it("repairs double-serialized JSON string", () => {
		const input = JSON.stringify(JSON.stringify({ query: "hello world" }));
		const result = repairAndParse(input);
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ query: "hello world" });
		expect(result.repaired).toBe(true);
		expect(result.strategyUsed).toBe("doubleSerializedJson");
	});

	it("returns null for non-quoted strings", () => {
		expect(doubleSerializedJson.attempt('{"valid": true}')).toBeNull();
	});
});

describe("markdownWrappedJson", () => {
	it("extracts JSON from ```json block", () => {
		const input = '```json\n{"action": "search", "query": "test"}\n```';
		const result = repairAndParse(input);
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ action: "search", query: "test" });
		expect(result.strategyUsed).toBe("markdownWrappedJson");
	});

	it("extracts JSON from ``` block without language tag", () => {
		const input = '```\n{"key": "value"}\n```';
		const result = repairAndParse(input);
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ key: "value" });
	});

	it("returns null for non-markdown input", () => {
		expect(markdownWrappedJson.attempt('{"valid": true}')).toBeNull();
	});
});

describe("trailingCommaJson", () => {
	it("fixes trailing comma before }", () => {
		const input = '{"name": "test", "value": 42,}';
		const result = repairAndParse(input);
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ name: "test", value: 42 });
		expect(result.strategyUsed).toBe("trailingCommaJson");
	});

	it("fixes trailing comma before ]", () => {
		const input = '{"items": [1, 2, 3,]}';
		const result = repairAndParse(input);
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ items: [1, 2, 3] });
	});

	it("returns null when no trailing commas exist", () => {
		expect(trailingCommaJson.attempt('{"valid": true}')).toBeNull();
	});
});

describe("singleQuotedJson", () => {
	it("converts single quotes to double quotes", () => {
		const input = "{'name': 'test', 'count': 5}";
		const result = repairAndParse(input);
		expect(result.success).toBe(true);
		expect(result.value).toEqual({ name: "test", count: 5 });
		expect(result.strategyUsed).toBe("singleQuotedJson");
	});

	it("returns null when no single quotes present", () => {
		expect(singleQuotedJson.attempt('{"valid": true}')).toBeNull();
	});
});

describe("emptyToEmptyObject", () => {
	it('converts empty string to {}', () => {
		const result = repairAndParse("");
		expect(result.success).toBe(true);
		expect(result.value).toEqual({});
		expect(result.strategyUsed).toBe("emptyToEmptyObject");
	});

	it('converts quoted empty string to {}', () => {
		const result = repairAndParse('""');
		expect(result.success).toBe(true);
		expect(result.value).toEqual({});
	});

	it("returns null for non-empty input", () => {
		expect(emptyToEmptyObject.attempt("something")).toBeNull();
	});
});
