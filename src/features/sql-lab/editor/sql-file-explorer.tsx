import {
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WorkspaceEntry } from "@/workspace/file-system";
import type { WorkspacePath } from "@/workspace/path";
import {
  projectSqlDirectoryEntries,
  workspaceBasename,
} from "@/features/sql-lab/editor/sql-lab-workspace";

export interface SqlFileExplorerProps {
  rootEntries: readonly WorkspaceEntry[];
  entriesByDirectory: ReadonlyMap<WorkspacePath, readonly WorkspaceEntry[]>;
  expandedDirectories: ReadonlySet<WorkspacePath>;
  loadingDirectories: ReadonlySet<WorkspacePath>;
  activePath?: WorkspacePath;
  showHidden: boolean;
  creatingFile: boolean;
  rootLoading?: boolean;
  onToggleDirectory: (path: WorkspacePath) => void;
  onOpenFile: (path: WorkspacePath) => void;
  onCreateFile: () => void;
  onShowHiddenChange: (next: boolean) => void;
}

export function SqlFileExplorer({
  rootEntries,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  activePath,
  showHidden,
  creatingFile,
  rootLoading = false,
  onToggleDirectory,
  onOpenFile,
  onCreateFile,
  onShowHiddenChange,
}: SqlFileExplorerProps) {
  const projectedRootEntries = projectSqlDirectoryEntries(rootEntries, showHidden);

  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card/60"
      data-testid="sql-lab-file-explorer"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <FolderOpen aria-hidden="true" className="size-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-tight">SQL Files</h2>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="New SQL file"
                data-testid="sql-lab-new"
                disabled={creatingFile}
                onClick={onCreateFile}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New SQL file</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={
                  showHidden
                    ? "Hide hidden and generated directories"
                    : "Show hidden and generated directories"
                }
                aria-pressed={showHidden}
                data-testid="sql-lab-show-hidden"
                onClick={() => onShowHiddenChange(!showHidden)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {showHidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {showHidden
                ? "Hide hidden and generated directories"
                : "Show hidden and generated directories"}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="SQL files" className="p-1">
          {rootLoading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              Loading workspace…
            </div>
          ) : projectedRootEntries.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No SQL files or directories</p>
          ) : (
            <DirectoryEntries
              activePath={activePath}
              depth={0}
              entries={projectedRootEntries}
              entriesByDirectory={entriesByDirectory}
              expandedDirectories={expandedDirectories}
              loadingDirectories={loadingDirectories}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
              showHidden={showHidden}
            />
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}

interface DirectoryEntriesProps {
  entries: readonly WorkspaceEntry[];
  entriesByDirectory: ReadonlyMap<WorkspacePath, readonly WorkspaceEntry[]>;
  expandedDirectories: ReadonlySet<WorkspacePath>;
  loadingDirectories: ReadonlySet<WorkspacePath>;
  activePath?: WorkspacePath;
  showHidden: boolean;
  depth: number;
  onToggleDirectory: (path: WorkspacePath) => void;
  onOpenFile: (path: WorkspacePath) => void;
}

function DirectoryEntries({
  entries,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  activePath,
  showHidden,
  depth,
  onToggleDirectory,
  onOpenFile,
}: DirectoryEntriesProps) {
  return entries.map((entry) => {
    if (entry.kind === "directory") {
      const expanded = expandedDirectories.has(entry.path);
      const loading = loadingDirectories.has(entry.path);
      const nestedEntries = projectSqlDirectoryEntries(
        entriesByDirectory.get(entry.path) ?? [],
        showHidden,
      );
      return (
        <Collapsible
          key={entry.path}
          onOpenChange={(nextOpen) => {
            if (nextOpen !== expanded) {
              onToggleDirectory(entry.path);
            }
          }}
          open={expanded}
        >
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <CollapsibleTrigger asChild>
                  <Button
                    aria-expanded={expanded}
                    className="group h-7 w-full justify-start gap-1.5 rounded-md px-1.5 text-muted-foreground hover:text-foreground"
                    data-testid={`sql-lab-directory-${entry.path}`}
                    style={{ paddingLeft: `${depth * 16 + 6}px` }}
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 shrink-0 transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                    {expanded ? (
                      <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-sky-300" />
                    ) : (
                      <Folder aria-hidden="true" className="size-4 shrink-0 text-sky-300" />
                    )}
                    <span className="min-w-0 truncate text-left">
                      {workspaceBasename(entry.path)}
                    </span>
                    {loading ? (
                      <LoaderCircle
                        aria-label="Loading"
                        className="ml-auto size-3.5 animate-spin"
                      />
                    ) : null}
                  </Button>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{entry.path}</TooltipContent>
            </Tooltip>
            <CollapsibleContent>
              {loading && nestedEntries.length === 0 ? (
                <div
                  className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
                >
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  Loading…
                </div>
              ) : nestedEntries.length > 0 ? (
                <DirectoryEntries
                  activePath={activePath}
                  depth={depth + 1}
                  entries={nestedEntries}
                  entriesByDirectory={entriesByDirectory}
                  expandedDirectories={expandedDirectories}
                  loadingDirectories={loadingDirectories}
                  onOpenFile={onOpenFile}
                  onToggleDirectory={onToggleDirectory}
                  showHidden={showHidden}
                />
              ) : (
                <p
                  className="py-2 pr-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${(depth + 1) * 16 + 6}px` }}
                >
                  No SQL files
                </p>
              )}
            </CollapsibleContent>
          </div>
        </Collapsible>
      );
    }

    const active = entry.path === activePath;
    return (
      <Tooltip key={entry.path}>
        <TooltipTrigger asChild>
          <Button
            aria-current={active ? "page" : undefined}
            className={cn(
              "h-7 w-full justify-start gap-2 rounded-md px-1.5 text-muted-foreground hover:text-foreground",
              active && "bg-accent text-accent-foreground hover:bg-accent",
            )}
            data-active={String(active)}
            data-testid={`sql-lab-file-${entry.path}`}
            onClick={() => onOpenFile(entry.path)}
            style={{ paddingLeft: `${depth * 16 + 24}px` }}
            title={entry.path}
            type="button"
            variant="ghost"
          >
            <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
            <span className="min-w-0 truncate text-left">{workspaceBasename(entry.path)}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{entry.path}</TooltipContent>
      </Tooltip>
    );
  });
}
