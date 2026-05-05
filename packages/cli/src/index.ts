import { Command } from "commander";
import { validate } from "./validate.js";
import { replay } from "./replay.js";
import { serve } from "./serve.js";
import { baselineShow, baselineRecompute } from "./baseline.js";
import { compare } from "./compare.js";
import { report } from "./report.js";
import { rootCause } from "./root-cause.js";

const program = new Command();

program
	.name("ho")
	.description("GenAI agent observability CLI")
	.version("0.1.0");

program
	.command("validate")
	.description("Validate a ho configuration file")
	.option("-c, --config <path>", "Config file path", "ho.config.yaml")
	.action(async (opts) => {
		const result = await validate(opts.config);
		console.log(result.output);
		process.exitCode = result.exitCode;
	});

program
	.command("replay")
	.description("Replay JSONL trace file through the pipeline")
	.requiredOption("-f, --file <path>", "JSONL file to replay")
	.option("-c, --config <path>", "Config file path")
	.action(async (opts) => {
		const result = await replay({ file: opts.file, config: opts.config });
		console.log(`Replayed ${result.linesProcessed} spans`);
	});

program
	.command("serve")
	.description("Run observability pipeline as a standalone process")
	.option("-c, --config <path>", "Config file path", "ho.config.yaml")
	.action(async (opts) => {
		const instance = await serve({ config: opts.config });
		console.log("Pipeline running. Press Ctrl+C to stop.");

		const shutdown = async () => {
			console.log("\nShutting down...");
			await instance.shutdown();
			process.exit(0);
		};

		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	});

program
	.command("baseline")
	.description("Show or recompute metric baselines")
	.option("-c, --config <path>", "Config file path", "ho.config.yaml")
	.option("--model <model>", "Filter by model")
	.option("--tool <tool>", "Filter by tool")
	.option("--format <fmt>", "Output format (md|json)", "md")
	.option("--recompute", "Force recompute baselines")
	.action(async (opts) => {
		if (opts.recompute) {
			const result = await baselineRecompute({ config: opts.config });
			console.log(result.output);
			process.exitCode = result.exitCode;
		} else {
			const result = await baselineShow({
				config: opts.config,
				model: opts.model,
				tool: opts.tool,
				format: opts.format,
			});
			console.log(result.output);
			process.exitCode = result.exitCode;
		}
	});

program
	.command("compare")
	.description("Compare metrics between two time windows")
	.requiredOption("--base <spec>", "Base time window (e.g. 7d)")
	.requiredOption("--target <spec>", "Target time window (e.g. 1d)")
	.option("-c, --config <path>", "Config file path", "ho.config.yaml")
	.option("--format <fmt>", "Output format (md|json)", "json")
	.action(async (opts) => {
		const result = await compare({
			config: opts.config,
			base: opts.base,
			target: opts.target,
			format: opts.format,
		});
		console.log(result.output);
		process.exitCode = result.exitCode;
	});

program
	.command("report")
	.description("Generate ops summary report")
	.option("-c, --config <path>", "Config file path", "ho.config.yaml")
	.option("--since <date>", "Period start (ISO date or relative like 7d)")
	.option("--format <fmt>", "Output format (md|json)", "md")
	.action(async (opts) => {
		const result = await report({
			config: opts.config,
			since: opts.since,
			format: opts.format,
		});
		console.log(result.output);
		process.exitCode = result.exitCode;
	});

program
	.command("root-cause")
	.description("Analyze trace for failure root cause")
	.argument("<traceId>", "Trace ID to analyze")
	.option("-c, --config <path>", "Config file path", "ho.config.yaml")
	.option("-f, --file <path>", "JSONL trace file")
	.action(async (traceId, opts) => {
		const result = await rootCause({
			config: opts.config,
			traceId,
			file: opts.file,
		});
		console.log(result.output);
		process.exitCode = result.exitCode;
	});

program.parse();
