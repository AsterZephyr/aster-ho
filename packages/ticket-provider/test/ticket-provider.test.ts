import { describe, expect, it, vi, beforeEach } from "vitest";
import { DedupCache } from "../src/dedup.js";
import { GitHubTicketProvider } from "../src/github.js";
import { LinearTicketProvider } from "../src/linear.js";
import type { TicketRequest, TicketResult } from "../src/types.js";

const makeRequest = (overrides?: Partial<TicketRequest>): TicketRequest => ({
	title: "Test issue",
	body: "Something broke",
	labels: ["bug"],
	fingerprint: "abc123",
	severity: "high",
	...overrides,
});

const makeResult = (overrides?: Partial<TicketResult>): TicketResult => ({
	id: "42",
	url: "https://github.com/owner/repo/issues/42",
	status: "open",
	createdAt: 1700000000000,
	...overrides,
});

describe("DedupCache", () => {
	let cache: DedupCache;

	beforeEach(() => {
		cache = new DedupCache();
	});

	it("set, get, has, and clear work correctly", () => {
		const result = makeResult();

		expect(cache.has("fp1")).toBe(false);
		expect(cache.get("fp1")).toBeUndefined();

		cache.set("fp1", result);

		expect(cache.has("fp1")).toBe(true);
		expect(cache.get("fp1")).toEqual(result);
		expect(cache.size).toBe(1);

		cache.clear();

		expect(cache.has("fp1")).toBe(false);
		expect(cache.size).toBe(0);
	});

	it("prevents duplicate by returning cached result for same fingerprint", () => {
		const result = makeResult();
		cache.set("fp-dup", result);

		const cached = cache.get("fp-dup");
		expect(cached).toEqual(result);
		expect(cached).toBe(result); // same reference
	});
});

describe("GitHubTicketProvider", () => {
	it("builds correct command args for createTicket", async () => {
		const provider = new GitHubTicketProvider({
			repo: "owner/repo",
			labels: ["ops"],
		});

		const execGhSpy = vi
			.spyOn(provider, "execGh")
			.mockResolvedValue("https://github.com/owner/repo/issues/99\n");

		const request = makeRequest({ labels: ["bug", "p1"] });
		const result = await provider.createTicket(request);

		expect(execGhSpy).toHaveBeenCalledOnce();
		const args = execGhSpy.mock.calls[0][0];

		expect(args).toContain("issue");
		expect(args).toContain("create");
		expect(args).toContain("--repo");
		expect(args).toContain("owner/repo");
		expect(args).toContain("--title");
		expect(args).toContain("Test issue");
		expect(args).toContain("--body");

		// Body should contain fingerprint footer
		const bodyIdx = args.indexOf("--body");
		const body = args[bodyIdx + 1];
		expect(body).toContain("<!-- ho-fingerprint: abc123 -->");

		// Labels: config labels + request labels
		const labelIndices = args.reduce<number[]>((acc, arg, i) => {
			if (arg === "--label") acc.push(i);
			return acc;
		}, []);
		const labelValues = labelIndices.map((i) => args[i + 1]);
		expect(labelValues).toContain("ops");
		expect(labelValues).toContain("bug");
		expect(labelValues).toContain("p1");

		expect(result.id).toBe("99");
		expect(result.url).toBe("https://github.com/owner/repo/issues/99");
		expect(result.status).toBe("open");
	});

	it("findDuplicate returns undefined for unknown fingerprint", async () => {
		const provider = new GitHubTicketProvider({ repo: "owner/repo" });

		vi.spyOn(provider, "execGh").mockResolvedValue("[]");

		const result = await provider.findDuplicate("unknown-fp");
		expect(result).toBeUndefined();
	});

	it("findDuplicate returns undefined on error", async () => {
		const provider = new GitHubTicketProvider({ repo: "owner/repo" });

		vi.spyOn(provider, "execGh").mockRejectedValue(
			new Error("gh not found"),
		);

		const result = await provider.findDuplicate("any-fp");
		expect(result).toBeUndefined();
	});
});

describe("LinearTicketProvider", () => {
	it("builds correct GraphQL body for createTicket", async () => {
		const provider = new LinearTicketProvider({
			apiKey: "lin_api_test",
			teamId: "team-123",
			labels: ["label-id-1"],
		});

		const mockResponse = {
			data: {
				issueCreate: {
					success: true,
					issue: {
						id: "LIN-456",
						url: "https://linear.app/team/issue/LIN-456",
						state: { name: "Todo" },
					},
				},
			},
		};

		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify(mockResponse), { status: 200 }),
			);

		const request = makeRequest();
		const result = await provider.createTicket(request);

		expect(fetchSpy).toHaveBeenCalledOnce();
		const [url, options] = fetchSpy.mock.calls[0];

		expect(url).toBe("https://api.linear.app/graphql");
		expect(options?.method).toBe("POST");
		expect(options?.headers).toEqual(
			expect.objectContaining({
				"Content-Type": "application/json",
				Authorization: "lin_api_test",
			}),
		);

		const body = JSON.parse(options?.body as string);
		expect(body.query).toContain("issueCreate");
		expect(body.variables.input.teamId).toBe("team-123");
		expect(body.variables.input.title).toBe("Test issue");
		expect(body.variables.input.description).toContain(
			"<!-- ho-fingerprint: abc123 -->",
		);

		expect(result.id).toBe("LIN-456");
		expect(result.url).toBe("https://linear.app/team/issue/LIN-456");
		expect(result.status).toBe("open");

		fetchSpy.mockRestore();
	});

	it("findDuplicate returns undefined for unknown fingerprint", async () => {
		const provider = new LinearTicketProvider({
			apiKey: "lin_api_test",
			teamId: "team-123",
		});

		const mockResponse = {
			data: {
				issueSearch: {
					nodes: [],
				},
			},
		};

		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify(mockResponse), { status: 200 }),
			);

		const result = await provider.findDuplicate("unknown-fp");
		expect(result).toBeUndefined();

		fetchSpy.mockRestore();
	});
});
