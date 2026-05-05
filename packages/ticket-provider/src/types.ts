export interface TicketProvider {
	readonly name: string;
	createTicket(request: TicketRequest): Promise<TicketResult>;
	findDuplicate(fingerprint: string): Promise<TicketResult | undefined>;
	close?(): Promise<void>;
}

export interface TicketRequest {
	readonly title: string;
	readonly body: string;
	readonly labels: readonly string[];
	readonly fingerprint: string;
	readonly severity: "low" | "medium" | "high" | "critical";
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TicketResult {
	readonly id: string;
	readonly url: string;
	readonly status: "open" | "closed" | "in_progress";
	readonly createdAt: number;
}

export interface GitHubTicketConfig {
	readonly repo: string; // "owner/repo"
	readonly labels?: readonly string[];
}

export interface LinearTicketConfig {
	readonly apiKey: string;
	readonly teamId: string;
	readonly labels?: readonly string[];
}
