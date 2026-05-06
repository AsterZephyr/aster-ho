import { execFile } from "node:child_process";
import type { GitHubTicketConfig, TicketProvider, TicketRequest, TicketResult } from "./types.js";

export class GitHubTicketProvider implements TicketProvider {
	readonly name = "github";
	private readonly config: GitHubTicketConfig;

	constructor(config: GitHubTicketConfig) {
		this.config = config;
	}

	async createTicket(request: TicketRequest): Promise<TicketResult> {
		const body = this.buildBody(request);
		const labels = this.buildLabels(request);

		const args = [
			"issue",
			"create",
			"--repo",
			this.config.repo,
			"--title",
			request.title,
			"--body",
			body,
		];

		for (const label of labels) {
			args.push("--label", label);
		}

		const stdout = await this.execGh(args);
		const url = stdout.trim();
		const id = this.extractIdFromUrl(url);

		return {
			id,
			url,
			status: "open",
			createdAt: Date.now(),
		};
	}

	async findDuplicate(fingerprint: string): Promise<TicketResult | undefined> {
		const args = [
			"issue",
			"list",
			"--repo",
			this.config.repo,
			"--search",
			`ho-fingerprint: ${fingerprint}`,
			"--json",
			"number,url,state",
			"--limit",
			"1",
		];

		try {
			const stdout = await this.execGh(args);
			const issues = JSON.parse(stdout) as Array<{
				number: number;
				url: string;
				state: string;
			}>;

			if (issues.length === 0) {
				return undefined;
			}

			const issue = issues[0];
			return {
				id: String(issue.number),
				url: issue.url,
				status: issue.state === "OPEN" ? "open" : "closed",
				createdAt: Date.now(),
			};
		} catch {
			return undefined;
		}
	}

	private buildBody(request: TicketRequest): string {
		const footer = `\n\n<!-- ho-fingerprint: ${request.fingerprint} -->`;
		return request.body + footer;
	}

	private buildLabels(request: TicketRequest): readonly string[] {
		const base = this.config.labels ?? [];
		return [...base, ...request.labels];
	}

	private extractIdFromUrl(url: string): string {
		const parts = url.split("/");
		return parts[parts.length - 1] ?? url;
	}

	execGh(args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile("gh", args, (error, stdout, stderr) => {
				if (error) {
					reject(new Error(`gh command failed: ${stderr || error.message}`));
					return;
				}
				resolve(stdout);
			});
		});
	}
}
