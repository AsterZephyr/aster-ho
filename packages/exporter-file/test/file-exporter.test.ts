import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileExporter } from "../src/index.js";

function mockSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
	return {
		spanContext: () => ({
			traceId: "abc123def456abc123def456abc123de",
			spanId: "1234567890abcdef",
			traceFlags: 1,
		}),
		parentSpanContext: undefined,
		name: "test-span",
		kind: SpanKind.INTERNAL,
		startTime: [1700000000, 0] as [number, number],
		endTime: [1700000001, 500000000] as [number, number],
		status: { code: SpanStatusCode.OK },
		attributes: { "gen_ai.system": "openai", "gen_ai.request.model": "gpt-4" },
		events: [],
		resource: { attributes: {} },
		instrumentationLibrary: { name: "@ho/sdk", version: "0.1.0" },
		...overrides,
	} as unknown as ReadableSpan;
}

describe("FileExporter", () => {
	let filePath: string;

	beforeEach(() => {
		filePath = join(tmpdir(), `ho-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
	});

	afterEach(async () => {
		try {
			await unlink(filePath);
		} catch {}
	});

	it("writes spans as JSONL", async () => {
		const exporter = new FileExporter({ filePath });

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan()], (result) => {
				expect(result.code).toBe(ExportResultCode.SUCCESS);
				resolve();
			});
		});

		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0]);
		expect(parsed.traceId).toBe("abc123def456abc123def456abc123de");
		expect(parsed.spanId).toBe("1234567890abcdef");
		expect(parsed.name).toBe("test-span");
		expect(parsed.durationMs).toBe(1500);
	});

	it("appends multiple exports to same file", async () => {
		const exporter = new FileExporter({ filePath });

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan({ name: "span-1" } as any)], () => resolve());
		});
		await new Promise<void>((resolve) => {
			exporter.export([mockSpan({ name: "span-2" } as any)], () => resolve());
		});

		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]).name).toBe("span-1");
		expect(JSON.parse(lines[1]).name).toBe("span-2");
	});

	it("supports pretty printing", async () => {
		const exporter = new FileExporter({ filePath, pretty: true });

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan()], () => resolve());
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("  ");
		expect(content).toContain('"traceId"');
	});

	it("includes parentSpanId when present", async () => {
		const exporter = new FileExporter({ filePath });
		const span = mockSpan({
			parentSpanContext: { spanId: "parent123456ab", traceId: "abc", traceFlags: 1 },
		} as any);

		await new Promise<void>((resolve) => {
			exporter.export([span], () => resolve());
		});

		const content = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.parentSpanId).toBe("parent123456ab");
	});

	it("serializes events", async () => {
		const exporter = new FileExporter({ filePath });
		const span = mockSpan({
			events: [
				{
					name: "exception",
					time: [1700000001, 0] as [number, number],
					attributes: { "exception.message": "oops" },
				},
			],
		} as any);

		await new Promise<void>((resolve) => {
			exporter.export([span], () => resolve());
		});

		const content = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.events).toHaveLength(1);
		expect(parsed.events[0].name).toBe("exception");
		expect(parsed.events[0].attributes["exception.message"]).toBe("oops");
	});

	it("handles error status with message", async () => {
		const exporter = new FileExporter({ filePath });
		const span = mockSpan({
			status: { code: SpanStatusCode.ERROR, message: "timeout" },
		} as any);

		await new Promise<void>((resolve) => {
			exporter.export([span], () => resolve());
		});

		const content = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.status.code).toBe(SpanStatusCode.ERROR);
		expect(parsed.status.message).toBe("timeout");
	});

	it("exports multiple spans in single call", async () => {
		const exporter = new FileExporter({ filePath });

		await new Promise<void>((resolve) => {
			exporter.export([mockSpan({ name: "a" } as any), mockSpan({ name: "b" } as any)], () =>
				resolve(),
			);
		});

		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);
	});

	it("shutdown waits for pending writes", async () => {
		const exporter = new FileExporter({ filePath });

		exporter.export([mockSpan()], () => {});
		await exporter.shutdown();

		const info = await stat(filePath);
		expect(info.size).toBeGreaterThan(0);
	});
});
