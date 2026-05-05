import { loadConfig, validateConfig } from "./config-loader.js";

export async function validate(configPath: string): Promise<{ exitCode: number; output: string }> {
	try {
		const config = await loadConfig(configPath);
		const result = validateConfig(config);

		if (result.valid) {
			return { exitCode: 0, output: `Config valid: ${configPath}` };
		}

		const errorList = result.errors.map((e) => `  - ${e}`).join("\n");
		return { exitCode: 1, output: `Config invalid: ${configPath}\n${errorList}` };
	} catch (err) {
		return { exitCode: 1, output: `Error: ${(err as Error).message}` };
	}
}
