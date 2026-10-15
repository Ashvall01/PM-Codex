/**
 * CODEX RULES — a folder is a folder, a page is a page.
 *
 * The Codex has two levels: folders at the top, pages inside them. A folder is
 * a Codex record with no parent. It holds pages and has no content of its own;
 * the screen never draws a folder's content. A page always sits in a folder.
 *
 * Both assistants used to be able to break that without noticing: write
 * content onto a folder (saved, never shown), put a page under a page (saved,
 * never shown), or file a page under a parent that does not exist (saved,
 * never shown). These rules are checked when a change is proposed — so the
 * assistant is told at once and can correct itself — and again when it is
 * signed off, by the one executor.
 *
 * Nothing here changes a record. Old data that breaks the rules stays as it
 * is and the Codex screen shows it (see Codex.tsx: folder notes, unfiled).
 */
import { useCodexStore, CodexPage } from '../store/codexStore';
import { useIdAliasStore } from '../store/idAliasStore';

export const isCodexFolder = (page: Pick<CodexPage, 'parentId'> | null | undefined): boolean =>
  !!page && !page.parentId;

/** A folder's own notes from before folders held only pages. */
export const hasFolderNotes = (page: CodexPage | null | undefined): boolean =>
  isCodexFolder(page) && !!String(page?.content || '').replace(/<[^>]*>/g, '').trim();

/**
 * The folder a page lives in: its parent, or for a page under a page, the
 * folder at the top of that chain. Null when the chain does not reach a
 * folder of the same project (a missing or foreign parent, or a loop).
 */
export function codexFolderOf(pages: CodexPage[], page: CodexPage | null | undefined): CodexPage | null {
  if (!page) return null;
  if (isCodexFolder(page)) return page;
  const byId = new Map(pages.filter((p) => p.projectId === page.projectId).map((p) => [p.id, p]));
  const seen = new Set<string>([page.id]);
  let current: CodexPage | undefined = page;
  while (current && current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) return null;
    if (isCodexFolder(parent)) return parent;
    seen.add(parent.id);
    current = parent;
  }
  return null;
}

/** The folders of one project, in the order the screen lists them. */
export function codexFolders(projectId: string): CodexPage[] {
  return useCodexStore.getState().pages.filter((p) => p.projectId === projectId && isCodexFolder(p));
}

/** A real id for whatever an assistant sent: a real id, or an alias it saw. */
function realCodexId(id: any): string {
  const s = String(id ?? '').trim();
  return s ? (useIdAliasStore.getState().getRealId(s) || s) : '';
}

function folderList(projectId: string): string {
  const alias = useIdAliasStore.getState().getAlias;
  const folders = codexFolders(projectId);
  return folders.length
    ? folders.map((f) => `${alias(f.id, 'CDX')} "${f.title}"`).join(', ')
    : 'none yet';
}

/** Folder titles compare without case or extra spaces: "Meeting Notes" is "MEETING NOTES". */
const sameTitle = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

export function findFolderByTitle(projectId: string, title: string): CodexPage | null {
  if (!String(title || '').trim()) return null;
  return codexFolders(projectId).find((f) => sameTitle(f.title, title)) || null;
}

export interface CodexTarget {
  /** The folder the page goes into, when it exists. */
  folder: CodexPage | null;
  /** A folder title to create, when the assistant named one that does not exist yet. */
  newFolderTitle?: string;
  /** Set when the parent given was a page: the page is filed in that page's folder instead. */
  flattenedFrom?: CodexPage;
}

/**
 * Where a new page goes. `parentId` (a folder id or alias) wins; `folder` (a
 * folder title) is the way to file into a folder that the same batch creates,
 * or that the assistant knows only by name. A parent that is a page resolves
 * to that page's folder.
 */
export function resolveCodexTarget(projectId: string, args: any): CodexTarget | string {
  const pages = useCodexStore.getState().pages.filter((p) => p.projectId === projectId);
  const parentKey = realCodexId(args?.parentId);
  if (parentKey) {
    const parent = pages.find((p) => p.id === parentKey);
    if (!parent) {
      return `There is no folder with id "${args.parentId}" in this project. Folders: ${folderList(projectId)}. `
        + 'Send parentId as one of those, or folder with a folder title (a new title creates that folder).';
    }
    if (isCodexFolder(parent)) return { folder: parent };
    const folder = codexFolderOf(pages, parent);
    if (!folder) return `"${parent.title}" is a page, not a folder, and it is not inside any folder. Folders: ${folderList(projectId)}.`;
    return { folder, flattenedFrom: parent };
  }
  const title = String(args?.folder ?? args?.folderTitle ?? '').trim();
  if (title) {
    const existing = findFolderByTitle(projectId, title);
    return existing ? { folder: existing } : { folder: null, newFolderTitle: title.toUpperCase() };
  }
  return `A Codex page must go into a folder. Send parentId (a folder id) or folder (a folder title; a new title creates the folder). Folders: ${folderList(projectId)}.`;
}

/**
 * The rules, for a proposal that is about to be filed. Returns a sentence for
 * the assistant when the change breaks one, or null when it is fine.
 *
 * Deliberately strict where the executor is forgiving: at proposal time the
 * assistant can still fix its own call, so it is told exactly what to send.
 */
export function checkCodexChange(name: string, args: any, projectId: string | null): string | null {
  if (!projectId) return null;
  const pages = useCodexStore.getState().pages.filter((p) => p.projectId === projectId);
  const alias = useIdAliasStore.getState().getAlias;

  if (name === 'createCodexFolder') {
    if (!String(args?.title || '').trim()) return 'createCodexFolder needs a title.';
    if (String(args?.content || '').trim()) {
      return 'A Codex folder holds pages and has no content of its own. Create the folder with a title only, '
        + 'then put the text in a createCodexPage with folder set to the same title.';
    }
    return null;
  }

  if (name === 'createCodexPage') {
    const target = resolveCodexTarget(projectId, args);
    if (typeof target === 'string') return target;
    if (target.flattenedFrom && target.folder) {
      return `"${target.flattenedFrom.title}" is a page, and pages cannot hold pages. `
        + `Put the new page in its folder instead: parentId ${alias(target.folder.id, 'CDX')} ("${target.folder.title}").`;
    }
    return null;
  }

  if (name === 'updateCodexPage') {
    const page = pages.find((p) => p.id === realCodexId(args?.id));
    if (!page) return null; // The executor says "not found" in its own words.
    if (isCodexFolder(page)) {
      if (args?.content !== undefined && String(args.content).trim()) {
        return `"${page.title}" is a folder. A folder has no content of its own — write the text as a page inside it `
          + `(createCodexPage with parentId ${alias(page.id, 'CDX')}), or update one of its pages.`;
      }
      if (args?.parentId) return `"${page.title}" is a folder. Folders cannot be moved inside anything.`;
      return null;
    }
    if (args?.parentId !== undefined) {
      const target = resolveCodexTarget(projectId, { parentId: args.parentId });
      if (typeof target === 'string') return target;
      if (target.flattenedFrom) return `A page can only be moved into a folder. Folders: ${folderList(projectId)}.`;
    }
    return null;
  }

  return null;
}
