import type { ChatMessage, StoredCitation } from "@gistlist/engine";
import { parseCitationMarkers } from "./citation-parser.js";

/**
 * Meta-question patterns. Short hand-written regexes that cover "what can
 * you do / how do i use you / who are you" without engaging the chat model.
 * Keep narrow — false positives here mean we skip retrieval, which is worse
 * than asking an unrelated question and getting the redirect rule.
 */
const META_PATTERNS: RegExp[] = [
  /^\s*(what can you|what do you|who are you|how do (i|you) use you|what are you|help)\b/i,
  /^\s*(hi|hello|hey)[\s!?.]*$/i,
];

export function isMetaQuery(userMessage: string): boolean {
  return META_PATTERNS.some((p) => p.test(userMessage));
}

export const META_CANNED_RESPONSE = `I'm your meeting assistant. Ask me things like:

- "What did I talk about with Lauren?"
- "When did we last discuss pricing?"
- "What are my upcoming meetings this week?"

I search your transcripts, summaries, and prep notes. I'll cite the exact meeting and moment so you can jump straight there.`;

export const FAIL_CLOSED_MESSAGE =
  "I found something but couldn't ground my answer — try rephrasing, or ask about a specific meeting or participant.";

export const EMPTY_RESULT_MESSAGE =
  "I couldn't find anything about that in your meetings. Try rephrasing, or name a person, topic, or date range.";

/**
 * Fail-closed check: if the assistant produced a multi-sentence factual-
 * looking response with zero citations, swap it for the hedge. Conservative:
 * single-sentence responses and questions are left alone.
 */
export function requiresCitation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Short single-sentence responses (no multi-sentence structure) don't trip.
  const sentenceCount = countSentences(trimmed);
  if (sentenceCount <= 1) return false;
  // If the response ends with a question, treat as a clarifying question,
  // which is allowed without citations.
  if (trimmed.endsWith("?")) return false;
  // Any multi-sentence declarative response with a reasonable amount of
  // prose content needs a citation.
  return trimmed.length >= 40;
}

export function hasCitations(text: string): boolean {
  return parseCitationMarkers(text).length > 0;
}

function countSentences(s: string): number {
  // Very rough — split on terminal punctuation.
  const parts = s.split(/[.!?]+/).map((p) => p.trim()).filter((p) => p.length > 0);
  return parts.length;
}

/**
 * Narrow reformat / restate phrasings. Must be explicit — a user saying
 * "shorter" or "which of those" alone does NOT count here. Broader signals
 * flow through `isShortReferentialFollowUp`, and both paths still require
 * the prior-assistant-cited prerequisite before they relax the guardrail.
 */
const REFORMAT_PATTERNS: RegExp[] = [
  /\bcopy[-\s]?past(e|able|eable)\b/i,
  /\breformat\b/i,
  /\brewrite\b/i,
  /\bre-?word\b/i,
  /\b(make|turn) (it|that|this|the (above|answer|response)) (shorter|longer|cleaner|simpler|into (a )?(bullet|list|table|markdown))/i,
  /\b(give|show|put) (me |it |that |this )?(in|as|with) (bullets?|bulleted|a (bullet(ed)?\s+)?(list|table)|markdown|plain text|copy[-\s]?paste)/i,
  /\bsummari[sz]e (that|the above|your (last |previous )?(answer|response))\b/i,
  /\btl;?dr\b(\s+(of )?(that|the above|your (last |previous )?(answer|response)))?/i,
];

export function isReformatOrFollowUpQuery(userMessage: string): boolean {
  return REFORMAT_PATTERNS.some((p) => p.test(userMessage));
}

/**
 * Short message anchored on a referential pronoun — almost always refers
 * back to the prior assistant answer ("which of those...", "why is it like
 * that", "tell me more about them"). The ≤80 char cap keeps this tight
 * enough that a genuinely new question doesn't sneak through.
 */
export function isShortReferentialFollowUp(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /\b(that|those|these|it|them)\b/i.test(trimmed);
}

/**
 * Walk backward through the thread history to find the most recent
 * assistant message (not the final entry, which may be the just-added
 * current user turn). Returns true iff that message's citations array is
 * non-empty.
 */
export function priorAssistantHadCitations(history: ChatMessage[]): boolean {
  const prior = findPriorAssistantMessage(history);
  return prior != null && prior.citations.length > 0;
}

/**
 * Returns the citations on the most recent prior assistant message, or an
 * empty array if none exists. Used to carry citations forward on grounded
 * follow-up turns when the model didn't re-emit markers.
 */
export function findPriorAssistantCitations(
  history: ChatMessage[]
): StoredCitation[] {
  const prior = findPriorAssistantMessage(history);
  return prior?.citations ?? [];
}

function findPriorAssistantMessage(
  history: ChatMessage[]
): ChatMessage | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "assistant") return history[i];
  }
  return null;
}
