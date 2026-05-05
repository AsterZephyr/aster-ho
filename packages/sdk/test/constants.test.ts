import { describe, expect, it } from "vitest";
import { context } from "@opentelemetry/api";
import { SUPPRESS_INSTRUMENTATION_KEY } from "../src/constants.js";

describe("SUPPRESS_INSTRUMENTATION_KEY", () => {
	it("can be set and read from context", () => {
		const ctx = context.active().setValue(SUPPRESS_INSTRUMENTATION_KEY, true);
		expect(ctx.getValue(SUPPRESS_INSTRUMENTATION_KEY)).toBe(true);
	});

	it("is not set by default", () => {
		expect(context.active().getValue(SUPPRESS_INSTRUMENTATION_KEY)).toBeUndefined();
	});
});
