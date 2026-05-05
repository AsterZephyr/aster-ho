import type { ParseResult, RepairStrategy } from "./types.js";

export const doubleSerializedJson: RepairStrategy = {
	name: "doubleSerializedJson",
	attempt(raw: string): string | null {
		if (!raw.startsWith('"') && !raw.startsWith("'")) return null;
		try {
			const unescaped = JSON.parse(raw);
			if (typeof unescaped === "string") return unescaped;
			return null;
		} catch {
			return null;
		}
	},
};

export const markdownWrappedJson: RepairStrategy = {
	name: "markdownWrappedJson",
	attempt(raw: string): string | null {
		const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
		if (match?.[1]) return match[1].trim();
		return null;
	},
};

export const trailingCommaJson: RepairStrategy = {
	name: "trailingCommaJson",
	attempt(raw: string): string | null {
		const cleaned = raw.replace(/,\s*([}\]])/g, "$1");
		if (cleaned === raw) return null;
		return cleaned;
	},
};

export const singleQuotedJson: RepairStrategy = {
	name: "singleQuotedJson",
	attempt(raw: string): string | null {
		if (!raw.includes("'")) return null;
		const replaced = raw.replace(/'/g, '"');
		return replaced;
	},
};

export const emptyToEmptyObject: RepairStrategy = {
	name: "emptyToEmptyObject",
	attempt(raw: string): string | null {
		if (raw.trim() === "" || raw.trim() === '""' || raw.trim() === "''") {
			return "{}";
		}
		return null;
	},
};

export const defaultRepairChain: RepairStrategy[] = [
	doubleSerializedJson,
	markdownWrappedJson,
	trailingCommaJson,
	singleQuotedJson,
	emptyToEmptyObject,
];

export function repairAndParse(
	raw: string,
	strategies: RepairStrategy[] = defaultRepairChain,
): ParseResult {
	// Try direct parse first
	try {
		const value = JSON.parse(raw);
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			return { success: true, value, repaired: false };
		}
	} catch {
		// Continue to repair strategies
	}

	// Try each strategy
	for (const strategy of strategies) {
		const repaired = strategy.attempt(raw);
		if (repaired === null) continue;

		try {
			const value = JSON.parse(repaired);
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				return { success: true, value, repaired: true, strategyUsed: strategy.name };
			}
		} catch {
			// Strategy produced invalid JSON, try next
		}
	}

	return { success: false, value: {}, repaired: false, error: `Failed to parse: ${raw.slice(0, 100)}` };
}
