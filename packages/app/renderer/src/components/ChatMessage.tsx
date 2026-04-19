import type { ChatCitationSource, ChatMessageDTO } from "../../../shared/ipc";
import { renderCitations } from "../lib/chat-citations";
import { cn } from "../lib/utils";

interface ChatMessageProps {
  message: ChatMessageDTO;
  onSeek: (runId: string, startMs: number, title: string) => void;
  onOpen: (
    runId: string,
    title: string,
    source: ChatCitationSource,
  ) => void;
}

export function ChatMessage({ message, onSeek, onOpen }: ChatMessageProps) {
  if (message.role === "user") {
    // Right-aligned muted bubble. Max 75% width so long prompts wrap but
    // short ones stay bubble-sized.
    return (
      <div className="flex w-full justify-end" data-role="user-row">
        <div
          className="max-w-[75%] rounded-2xl bg-[var(--bg-secondary)] px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap"
          data-testid="chat-message"
          data-role="user"
        >
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant: no bubble, left-aligned within the reading column.
  const nodes = renderCitations(message.content, {
    citations: message.citations,
    onSeek,
    onOpen,
  });

  return (
    <div
      className={cn(
        "w-full text-sm leading-relaxed text-[var(--text-primary)]",
      )}
      data-testid="chat-message"
      data-role="assistant"
    >
      {nodes.map((node, i) => (
        <span key={i}>{node}</span>
      ))}
    </div>
  );
}
