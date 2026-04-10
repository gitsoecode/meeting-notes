import type { PromptRow } from "./ipc.js";

export const PRIMARY_PROMPT_ID = "summary";

export interface MeetingPromptManifestSection {
  filename?: string;
  label?: string;
  status?: string;
}

export interface MeetingPromptFile {
  name: string;
  kind?: "document" | "log" | "media";
}

export interface MeetingAnalysisPromptItem {
  id: string;
  label: string;
  description: string | null;
  fileName: string;
  status?: string;
  hasOutput: boolean;
  prompt: PromptRow;
}

export interface MeetingPromptCollections {
  primaryPrompt: PromptRow | null;
  summaryFileName: string;
  summaryStatus?: string;
  summaryHasOutput: boolean;
  analysisPrompts: MeetingAnalysisPromptItem[];
}

export function isPrimaryPromptId(id: string | null | undefined): boolean {
  return id === PRIMARY_PROMPT_ID;
}

export function buildMeetingPromptCollections({
  prompts,
  manifestSections,
  files,
}: {
  prompts: PromptRow[];
  manifestSections?: Record<string, MeetingPromptManifestSection>;
  files?: MeetingPromptFile[];
}): MeetingPromptCollections {
  const sections = manifestSections ?? {};
  const documentNames = new Set(
    (files ?? [])
      .filter((file) => file.kind !== "media")
      .map((file) => file.name)
  );

  const primaryPrompt = prompts.find((prompt) => isPrimaryPromptId(prompt.id)) ?? null;
  const summarySection = sections[PRIMARY_PROMPT_ID];
  const summaryFileName = summarySection?.filename || primaryPrompt?.filename || "summary.md";

  const analysisPrompts = prompts
    .filter((prompt) => !isPrimaryPromptId(prompt.id))
    .map((prompt) => {
      const section = sections[prompt.id];
      const fileName = section?.filename || prompt.filename;
      return {
        id: prompt.id,
        label: section?.label || prompt.label,
        description: prompt.description,
        fileName,
        status: section?.status,
        hasOutput: documentNames.has(fileName),
        prompt,
      };
    });

  return {
    primaryPrompt,
    summaryFileName,
    summaryStatus: summarySection?.status,
    summaryHasOutput: documentNames.has(summaryFileName),
    analysisPrompts,
  };
}
