import type { TicketResult } from "./types.js";

export class DedupCache {
	private readonly cache: Map<string, TicketResult> = new Map();

	has(fingerprint: string): boolean {
		return this.cache.has(fingerprint);
	}

	get(fingerprint: string): TicketResult | undefined {
		return this.cache.get(fingerprint);
	}

	set(fingerprint: string, result: TicketResult): void {
		this.cache.set(fingerprint, result);
	}

	clear(): void {
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}
}
