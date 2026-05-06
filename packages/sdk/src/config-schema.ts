import { z } from "zod";

export const CaptureContentSchema = z.object({
	input: z.boolean().optional(),
	output: z.boolean().optional(),
	toolArguments: z.boolean().optional(),
	toolResults: z.boolean().optional(),
});

export const HoConfigSchema = z.object({
	serviceName: z.string().min(1, "serviceName must be non-empty").optional(),
	instrumentations: z.array(z.any()).optional(),
	enrichers: z.array(z.any()).optional(),
	exporters: z.array(z.any()).optional(),
	dev: z.boolean().optional(),
	captureContent: CaptureContentSchema.optional(),
	autoShutdown: z.boolean().optional(),
});

export class HoConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HoConfigError";
	}
}

export function validateConfig(config: unknown): void {
	const result = HoConfigSchema.safeParse(config);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new HoConfigError(`Invalid HoConfig:\n${issues}`);
	}
}
