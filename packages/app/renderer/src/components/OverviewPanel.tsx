import { useState } from "react";
import { api } from "../ipc-client";
import type { RunDetail } from "../../../shared/ipc";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { FolderOpen, Info, Pencil } from "lucide-react";
import { findModelEntry } from "../../../shared/llm-catalog";

interface OverviewPanelProps {
  detail: RunDetail;
  runFolder: string;
  onUpdated: () => void;
}

interface ManifestShape {
  description?: string | null;
  participants?: string[];
  tags?: string[];
  source_mode?: string;
  asr_provider?: string;
  llm_provider?: string;
  sections?: Record<
    string,
    {
      status?: string;
      label?: string;
      filename?: string;
      model?: string;
    }
  >;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function OverviewPanel({ detail, runFolder, onUpdated }: OverviewPanelProps) {
  const manifest = (detail.manifest ?? {}) as ManifestShape;
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(
    detail.description ?? manifest.description ?? ""
  );
  const [savingDescription, setSavingDescription] = useState(false);

  const description = detail.description ?? manifest.description ?? "";
  const startedDate = new Date(detail.started || detail.date);
  const endedDate = detail.ended ? new Date(detail.ended) : null;
  const participants = manifest.participants ?? [];
  const tags = detail.tags ?? manifest.tags ?? [];
  const promptOutputs = manifest.prompt_outputs ?? {};
  const outputEntries = Object.entries(promptOutputs);

  const onSaveDescription = async () => {
    setSavingDescription(true);
    try {
      await api.runs.updateMeta({
        runFolder,
        description: descriptionDraft.trim() || null,
      });
      setEditingDescription(false);
      onUpdated();
    } finally {
      setSavingDescription(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Meeting Metadata Card */}
      <Card className="shadow-sm border-[var(--border-subtle)] bg-white">
        <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-[var(--text-tertiary)]" />
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              Meeting metadata
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-[var(--border-subtle)]">
            <MetadataRow label="Status">
              <span className="text-xs font-medium">{detail.status}</span>
              {manifest.source_mode && (
                <span className="ml-2 text-xs text-[var(--text-tertiary)] italic">
                  ({manifest.source_mode})
                </span>
              )}
            </MetadataRow>
            <MetadataRow label="Description">
              {editingDescription ? (
                <div className="space-y-3">
                  <Textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    placeholder="What was this meeting about?"
                    rows={3}
                    className="resize-none border-[var(--border-default)] text-sm"
                    disabled={savingDescription}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingDescription(false);
                        setDescriptionDraft(description);
                      }}
                      disabled={savingDescription}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={onSaveDescription} disabled={savingDescription}>
                      {savingDescription ? <><Spinner className="mr-1.5 h-3 w-3" /> Saving</> : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="group flex items-start gap-2 cursor-pointer rounded px-1 -mx-1 transition-colors hover:bg-[var(--bg-secondary)]/50"
                  onClick={() => setEditingDescription(true)}
                >
                  <span className={`text-xs leading-relaxed flex-1 ${description ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)] italic"}`}>
                    {description || "Click to add a description…"}
                  </span>
                  <Pencil className="h-3 w-3 mt-0.5 shrink-0 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </MetadataRow>
            <MetadataRow label="Timeline">
              <div className="text-xs">
                <div>{startedDate.toLocaleString()}</div>
                {endedDate && (
                  <div className="text-[var(--text-tertiary)] mt-0.5">
                    Ended: {endedDate.toLocaleString()}
                  </div>
                )}
              </div>
            </MetadataRow>
            <MetadataRow label="Duration">
              <span className="text-xs">
                {detail.duration_minutes != null ? `${detail.duration_minutes.toFixed(1)} min` : "—"}
              </span>
            </MetadataRow>
            <MetadataRow label="Providers">
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase w-8">ASR:</span>
                  <span>{manifest.asr_provider ?? detail.source_mode}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase w-8">LLM:</span>
                  <span>{manifest.llm_provider ?? "—"}</span>
                </div>
              </div>
            </MetadataRow>
            {participants.length > 0 && (
              <MetadataRow label="Participants">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {participants.map((p) => (
                    <span key={p} className="rounded bg-[var(--bg-secondary)] px-2 py-0.5 text-[var(--text-secondary)]">{p}</span>
                  ))}
                </div>
              </MetadataRow>
            )}
            {tags.length > 0 && (
              <MetadataRow label="Tags">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {tags.map((t) => (
                    <span key={t} className="rounded bg-[var(--accent-muted)] px-2 py-0.5 text-[var(--accent)]">#{t}</span>
                  ))}
                </div>
              </MetadataRow>
            )}
            {outputEntries.length > 0 && (
              <MetadataRow label="Prompt Outputs">
                <div className="space-y-1 text-xs">
                  {outputEntries.map(([id, section]) => (
                    <div key={id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[var(--text-primary)]">{section.label ?? id}</span>
                        {section.model && (
                          <span className="ml-2 text-[10px] text-[var(--text-tertiary)]">
                            {findModelEntry(section.model)?.label ?? section.model}
                          </span>
                        )}
                      </div>
                      <span className={`shrink-0 text-[10px] font-medium uppercase ${
                        section.status === "complete" ? "text-emerald-600"
                          : section.status === "failed" ? "text-[var(--error)]"
                          : section.status === "running" ? "text-blue-600"
                          : "text-[var(--text-tertiary)]"
                      }`}>
                        {section.status ?? "pending"}
                      </span>
                    </div>
                  ))}
                </div>
              </MetadataRow>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Run Folder Contents Card */}
      {detail.files.length > 0 && (
        <Card className="shadow-sm border-[var(--border-subtle)] bg-white overflow-hidden">
          <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/10 px-6 py-4">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-[var(--text-tertiary)]" />
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                Run folder contents
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-[var(--bg-secondary)]/5">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest">Filename</TableHead>
                  <TableHead className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest">Kind</TableHead>
                  <TableHead className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.files.map((file) => (
                  <TableRow key={file.name} className="group border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)]/10">
                    <TableCell className="px-6 py-3 font-mono text-[11px] text-[var(--text-primary)] truncate max-w-[180px]">
                      {file.name}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-[10px] text-[var(--text-tertiary)] uppercase font-semibold tracking-wider">
                      {file.kind}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right text-xs font-medium text-[var(--text-secondary)]">
                      {fmtBytes(file.size)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetadataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start gap-4 px-6 py-3 text-sm">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] pt-0.5">
        {label}
      </div>
      <div className="text-[var(--text-primary)]">{children}</div>
    </div>
  );
}
