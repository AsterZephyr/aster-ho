export interface ModelPricing {
	inputPerToken: number;
	outputPerToken: number;
	cacheReadPerToken?: number;
	cacheCreationPerToken?: number;
}

export const defaultPricing: Record<string, ModelPricing> = {
	"gpt-4o": { inputPerToken: 2.5e-6, outputPerToken: 10e-6 },
	"gpt-4o-mini": { inputPerToken: 0.15e-6, outputPerToken: 0.6e-6 },
	"gpt-4.1": { inputPerToken: 2e-6, outputPerToken: 8e-6 },
	"gpt-4.1-mini": { inputPerToken: 0.4e-6, outputPerToken: 1.6e-6 },
	"gpt-4.1-nano": { inputPerToken: 0.1e-6, outputPerToken: 0.4e-6 },
	o3: { inputPerToken: 2e-6, outputPerToken: 8e-6 },
	"o3-mini": { inputPerToken: 1.1e-6, outputPerToken: 4.4e-6 },
	"o4-mini": { inputPerToken: 1.1e-6, outputPerToken: 4.4e-6 },
	"claude-sonnet-4-5-20250514": { inputPerToken: 3e-6, outputPerToken: 15e-6 },
	"claude-opus-4-5-20250414": { inputPerToken: 15e-6, outputPerToken: 75e-6 },
	"claude-haiku-3-5-20241022": { inputPerToken: 0.8e-6, outputPerToken: 4e-6 },
	"gemini-2.0-flash": { inputPerToken: 0.1e-6, outputPerToken: 0.4e-6 },
	"gemini-2.5-pro": { inputPerToken: 1.25e-6, outputPerToken: 10e-6 },
	"gemini-2.5-flash": { inputPerToken: 0.15e-6, outputPerToken: 0.6e-6 },
};

export function mergePricing(
	base: Record<string, ModelPricing>,
	overrides: Record<string, ModelPricing>,
): Record<string, ModelPricing> {
	return { ...base, ...overrides };
}
