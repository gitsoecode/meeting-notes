import { useState } from "react";
import { api } from "../ipc-client";
import type { RunDetail } from "../../../shared/ipc";
import { Badge } from "./ui/badge";
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
import { FileIcon, FileText, FolderOpen, Info, Pencil, Tag, Users } from "lucide-react";

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
  const sections = manifest.sections ?? {};
  const sectionEntries = Object.entries(sections);

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
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Run Details Card */}
        <Card className="shadow-sm border-[var(--border-subtle)] bg-white">
          <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/10 px-6 py-4">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--text-tertiary)]" />
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                Run details
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border-subtle)]">
              <MetadataRow label="Status">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      detail.status === "complete" ? "success"
                        : detail.status === "processing" ? "info"
                        : detail.status === "error" ? "destructive"
                        : "warning"
                    }
                    className="h-5 px-1.5 text-[10px]"
                  >
                    {detail.status}
                  </Badge>
                  {manifest.source_mode && (
                    <span className="text-xs text-[var(--text-tertiary)] italic">
                      ({manifest.source_mode})
                    </span>
                  )}
                </div>
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
            </div>
          </CardContent>
        </Card>

        {/* Meeting Context Card */}
        <Card className="shadow-sm border-[var(--border-subtle)] bg-white">
          <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/10 px-6 py-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--text-tertiary)]" />
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                Meeting context
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {editingDescription ? (
              <div className="space-y-4">
                <Textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder="What was this meeting about?"
                  rows={4}
                  className="resize-none border-[var(--border-default)] focus:ring-[var(--accent)]/30"
                  disabled={savingDescription}
                />
                <div className="flex justify-end gap-3">
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
                  <Button
                    size="sm"
                    onClick={onSaveDescription}
                    disabled={savingDescription}
                    className="h-8"
                  >
                    {savingDescription ? <><Spinner className="mr-2 h-3.5 w-3.5" /> Saving</> : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="group relative cursor-pointer rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]/10 p-4 transition-colors hover:bg-[var(--bg-secondary)]/30"
                onClick={() => setEditingDescription(true)}
              >
                <div className={`text-sm leading-relaxed ${description ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)] italic"}`}>
                  {description || "Click to add a description…"}
                </div>
                <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Pencil className="h-3 w-3 text-[var(--text-tertiary)]" />
                </div>
              </div>
            )}

            {(participants.length > 0 || tags.length > 0) && (
              <div className="mt-6 space-y-4 pt-6 border-t border-[var(--border-subtle)]">
                {participants.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                      <Users className="h-3 w-3" />
                      Participants
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {participants.map((p) => (
                        <Badge key={p} variant="neutral" className="h-6 rounded px-2 normal-case tracking-normal font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                      <Tag className="h-3 w-3" />
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((t) => (
                        <Badge key={t} variant="neutral" className="h-6 rounded px-2 normal-case tracking-normal font-medium bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent)]/20">
                          #{t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sections & Files */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Generated Sections */}
        {sectionEntries.length > 0 && (
          <Card className="shadow-sm border-[var(--border-subtle)] bg-white overflow-hidden">
            <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/10 px-6 py-4">
              <div className="flex items-center gap-2">
                <FileIcon className="h-4 w-4 text-[var(--text-tertiary)]" />
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                  Generated sections
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-[var(--bg-secondary)]/5">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest">Section</TableHead>
                    <TableHead className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest">Filename</TableHead>
                    <TableHead className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sectionEntries.map(([id, section]) => (
                    <TableRow key={id} className="group border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)]/10">
                      <TableCell className="px-6 py-3 font-medium text-xs text-[var(--text-primary)]">
                        {section.label ?? id}
                      </TableCell>
                      <TableCell className="px-6 py-3 font-mono text-[10px] text-[var(--text-tertiary)]">
                        {section.filename ?? "—"}
                      </TableCell>
                      <TableCell className="px-6 py-3 text-right">
                        <Badge
                          variant={
                            section.status === "complete" ? "success"
                              : section.status === "running" ? "info"
                              : section.status === "failed" ? "destructive"
                              : "neutral"
                          }
                          className="h-5 px-1.5 text-[9px]"
                        >
                          {section.status ?? "pending"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Run Folder Contents */}
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
