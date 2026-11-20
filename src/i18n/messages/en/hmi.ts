import type { hmiDe } from "../de/hmi";

export const hmiEn = {
  "hmi.title": "HMI",
  "hmi.backToPlanner": "To the pallet planner",
  "hmi.loading": "Loading HMI …",
  "hmi.state.unavailable":
    "This installation stores data locally in the browser and has no HMIs.",
  "hmi.state.unauthenticated": "Please sign in to propose a plan to this HMI.",
  "hmi.state.notFound": "This HMI is not registered.",
  "hmi.state.error": "The HMI could not be loaded.",
  "hmi.signIn": "Sign in",
  "hmi.retry": "Reload",
  "hmi.seen": "last seen {when}",
  "hmi.running": "running: {name}",
  "hmi.running.withdrawn": "running: {name} (withdrawn)",
  "hmi.running.none": "running: no plan from the planner",
  "hmi.revoked":
    "This HMI is revoked and fetches no plans. Proposals are possible again once an admin generates a new token.",
  "hmi.proposal.heading": "Plan proposal",
  "hmi.proposal.by": "{name} · proposed by {user}",
  "hmi.proposal.byUnknown": "{name}",
  "hmi.proposal.state.pending":
    "Waiting for confirmation on the HMI. Nothing changes until the operator accepts.",
  "hmi.proposal.state.pendingOffline":
    "The HMI is not reachable right now. The proposal arrives once it is back online.",
  "hmi.proposal.state.accepted": "Accepted.",
  "hmi.proposal.state.rejected": "Rejected on the HMI.",
  "hmi.proposal.state.superseded":
    "Superseded – by a newer proposal or because the finished version was withdrawn.",
  "hmi.proposal.state.expired": "Expired: no answer within 24 hours.",
  "hmi.proposal.state.cancelled": "Taken back.",
  "hmi.proposal.cancel": "Take back proposal",
  "hmi.proposal.cancelSuccess": "The proposal was taken back.",
  "hmi.finals.heading": "Finished versions",
  "hmi.finals.search": "Search finished versions",
  "hmi.finals.loading": "Loading finished versions …",
  "hmi.finals.loadError": "The finished versions could not be loaded.",
  "hmi.finals.empty": "No plan is marked finished yet.",
  "hmi.finals.noMatch": "No finished version matches the search.",
  "hmi.finals.running": "running here",
  "hmi.propose.submit": "Propose to HMI",
  "hmi.propose.sending": "Sending …",
  "hmi.propose.pick": "Please choose a finished version first.",
  "hmi.propose.hint":
    "The HMI asks its operator. The running plan only changes after the operator confirms.",
  "hmi.propose.success": "Proposal sent to {hmi}.",
  "hmi.error.unauthenticated": "Your session expired. Please sign in again.",
  "hmi.error.forbidden": "You may not propose plans.",
  "hmi.error.finalGone":
    "This finished version has been withdrawn or replaced in the meantime.",
  "hmi.error.revoked": "The HMI is revoked.",
  "hmi.error.notFound": "This HMI is not registered.",
  "hmi.error.proposalClosed":
    "The proposal was already answered, superseded or has expired.",
  "hmi.error.generic": "That did not work. Please try again.",
} as const satisfies Record<keyof typeof hmiDe, string>;
