export type {
	TicketProvider,
	TicketRequest,
	TicketResult,
	GitHubTicketConfig,
	LinearTicketConfig,
} from "./types.js";

export { GitHubTicketProvider } from "./github.js";
export { LinearTicketProvider } from "./linear.js";
export { DedupCache } from "./dedup.js";
