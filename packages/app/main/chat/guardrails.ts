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
