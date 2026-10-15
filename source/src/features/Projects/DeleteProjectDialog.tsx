/**
 * Deleting a project: what goes, a backup first, and the name typed to confirm.
 *
 * The one place the app removes a whole project's data on purpose, so it asks
 * for more than a click: the user reads what will be removed, types the
 * project's name, and the backup file is downloaded before anything is
 * deleted. If the download cannot be started, nothing is deleted.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Download, X } from 'lucide-react';
import gsap from 'gsap';
import { Project } from '../../store/appStore';
import { projectContents, downloadProjectBackup, deleteProjectEverywhere, backupFileName } from '../../services/projectRemoval';

export const DeleteProjectDialog: React.FC<{
  project: Project;
  onClose: () => void;
  onDeleted: (message: string) => void;
}> = ({ project, onClose, onDeleted }) => {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contents = useMemo(() => projectContents(project.id), [project.id]);
  const panelRef = useRef<HTMLDivElement>(null);
  const matches = typed.trim().toLowerCase() === project.name.trim().toLowerCase();

  useEffect(() => {
    gsap.fromTo(panelRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await downloadProjectBackup(project.id);
      if (!saved) throw new Error('The backup could not be made.');
      // Give the browser a moment to hand the file over before the records go.
      await new Promise((r) => setTimeout(r, 400));
      deleteProjectEverywhere(project.id);
      onDeleted(`"${project.name}" was deleted. Its backup is in your Downloads: ${backupFileName(project)}`);
    } catch (err: any) {
      setBusy(false);
      setError(`Nothing was deleted. ${err?.message || 'The backup download did not start.'}`);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-qb-bg/70 p-4" style={{ backdropFilter: 'blur(10px)' }}>
      <div ref={panelRef} className="relative w-full max-w-lg bg-qb-bg border border-qb-light-grey shadow-2xl">
        <div className="absolute top-0 left-0 h-1 w-16 bg-qb-magenta" />
        <div className="flex items-start justify-between px-6 pt-6">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-qb-magenta flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5" /> Delete project
            </div>
            <h2 className="text-2xl font-black text-qb-black mt-2 break-words">{project.name}</h2>
          </div>
          <button onClick={onClose} disabled={busy} className="text-qb-grey hover:text-qb-black p-1" title="Cancel">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4 text-sm text-qb-dark-grey">
          <p>
            Everything in this project is removed from PM Codex and, at the next save, from your Google Sheet:
          </p>
          {contents.length ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] uppercase tracking-wider border-y border-qb-light-grey py-3">
              {contents.map((c) => (
                <div key={c.label} className="flex justify-between gap-3">
                  <span className="text-qb-grey">{c.label}</span>
                  <span className="font-bold text-qb-black">{c.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] uppercase tracking-wider text-qb-grey">The project is empty.</p>
          )}
          <p className="flex items-start gap-2 bg-qb-box-bg px-3 py-2.5 text-xs leading-relaxed">
            <Download className="w-4 h-4 text-qb-orange shrink-0 mt-0.5" />
            <span>
              A backup of the whole project is saved to your Downloads first. To bring the project back, choose
              <b> Restore from backup</b> on this screen and pick that file.
            </span>
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-qb-grey">Type the project name to confirm</span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
              placeholder={project.name}
              disabled={busy}
              className="w-full bg-transparent border-b-2 border-qb-light-grey focus:border-qb-magenta px-0 py-2 text-base font-bold text-qb-black placeholder-qb-light-grey outline-none"
            />
          </label>
          {error && <p className="text-xs font-bold text-qb-magenta">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-qb-dark-grey hover:text-qb-black border border-qb-light-grey hover:border-qb-black transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!matches || busy}
            className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white bg-qb-magenta hover:bg-qb-black transition-colors disabled:opacity-40 disabled:hover:bg-qb-magenta disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            {busy ? 'Saving backup…' : 'Save backup & delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
