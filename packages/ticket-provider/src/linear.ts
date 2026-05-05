import type {
	LinearTicketConfig,
	TicketProvider,
	TicketRequest,
	TicketResult,
} from "./types.js";

interface LinearIssueCreateResponse {
	readonly data?: {
		readonly issueCreate?: {
			readonly success: boolean;
			readonly issue?: {
				readonly id: string;
				readonly url: string;
				readonly state?: {
					readonly name: string;
				};
			};
		};
	};
	readonly errors?: ReadonlyArray<{ readonly message: string }>;
}

interface LinearIssueSearchResponse {
	readonly data?: {
		readonly issueSearch?: {
			readonly nodes?: ReadonlyArray<{
				readonly id: string;
				readonly url: string;
				readonly state?: {
					readonly name: string;
				};
				readonly createdAt?: string;
			}>;
		};
	};
}

export class LinearTicketProvider implements TicketProvider {
	readonly name = "linear";
	private readonly config: LinearTicketConfig;

	constructor(config: LinearTicketConfig) {
		this.config = config;
	}

	async createTicket(request: TicketRequest): Promise<TicketResult> {
		const description = this.buildDescription(request);
		const labelIds = this.config.labels ?? [];

		const mutation = `
			mutation IssueCreate($input: IssueCreateInput!) {
				issueCreate(input: $input) {
					success
					issue {
						id
						url
						state { name }
					}
				}
			}
		`;

		const variables = {
			input: {
				teamId: this.config.teamId,
				title: request.title,
				description,
				labelIds: [...labelIds, ...request.labels],
			},
		};

		const response = await this.graphql<LinearIssueCreateResponse>(
			mutation,
			variables,
		);

		const issueCreate = response.data?.issueCreate;
		if (!issueCreate?.success || !issueCreate.issue) {
			const errorMsg =
				response.errors?.map((e) => e.message).join(", ") ??
				"Unknown error";
			throw new Error(`Linear issue creation failed: ${errorMsg}`);
		}

		const issue = issueCreate.issue;
		return {
			id: issue.id,
			url: issue.url,
			status: this.mapState(issue.state?.name),
			createdAt: Date.now(),
		};
	}

	async findDuplicate(fingerprint: string): Promise<TicketResult | undefined> {
		const query = `
			query IssueSearch($filter: IssueFilter) {
				issueSearch(filter: $filter, first: 1) {
					nodes {
						id
						url
						state { name }
						createdAt
					}
				}
			}
		`;

		const variables = {
			filter: {
				description: { contains: `ho-fingerprint: ${fingerprint}` },
				team: { id: { eq: this.config.teamId } },
			},
		};

		try {
			const response = await this.graphql<LinearIssueSearchResponse>(
				query,
				variables,
			);

			const nodes = response.data?.issueSearch?.nodes;
			if (!nodes || nodes.length === 0) {
				return undefined;
			}

			const issue = nodes[0];
			return {
				id: issue.id,
				url: issue.url,
				status: this.mapState(issue.state?.name),
				createdAt: issue.createdAt
					? new Date(issue.createdAt).getTime()
					: Date.now(),
			};
		} catch {
			return undefined;
		}
	}

	private buildDescription(request: TicketRequest): string {
		const footer = `\n\n<!-- ho-fingerprint: ${request.fingerprint} -->`;
		return request.body + footer;
	}

	private mapState(
		stateName: string | undefined,
	): "open" | "closed" | "in_progress" {
		if (!stateName) return "open";
		const lower = stateName.toLowerCase();
		if (lower === "done" || lower === "canceled" || lower === "cancelled") {
			return "closed";
		}
		if (lower === "in progress" || lower === "started") {
			return "in_progress";
		}
		return "open";
	}

	private async graphql<T>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: this.config.apiKey,
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!response.ok) {
			throw new Error(
				`Linear API request failed: ${response.status} ${response.statusText}`,
			);
		}

		return (await response.json()) as T;
	}
}
