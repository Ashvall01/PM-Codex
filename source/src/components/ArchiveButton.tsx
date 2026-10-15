import React from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';

/**
 * The archive / restore button for a module's detail tray header.
 *
 * One component, two faces: it shows ARCHIVE on an active record and RESTORE
 * on an archived one, so a tray never has to decide which to draw. Shaped like
 * the buttons already in those headers (p-3, border-2).
 *
 * No confirmation dialog on either action, deliberately. ConfirmationDialog is
 * for things that cannot be undone; both of these can. A dialog here would
 * teach the user to click through dialogs, which is what makes the delete
 * dialog stop working.
 */
interface ArchiveButtonProps {
  isArchived: boolean;
  onArchive: () => void;
  onRestore: () => void;
  /** What the record is called in the tooltip. For example 'item' or 'risk'. */
  noun?: string;
}

export const ArchiveButton: React.FC<ArchiveButtonProps> = ({
  isArchived,
  onArchive,
  onRestore,
  noun = 'item',
}) => (
  <button
    type="button"
    onClick={isArchived ? onRestore : onArchive}
    className="p-3 bg-transparent text-qb-grey hover:text-qb-cyan border-2 border-qb-light-grey hover:border-qb-cyan transition-colors cursor-pointer flex items-center justify-center"
    title={isArchived ? `Restore this ${noun} to the active list` : `Archive this ${noun}`}
  >
    {isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
  </button>
);
