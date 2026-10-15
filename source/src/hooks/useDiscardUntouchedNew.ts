import { useEffect, useRef } from 'react';

/**
 * A "New …" button makes the record straight away, so its detail panel can
 * edit it. If the panel is then closed (or another record opened, or the page
 * left) with nothing typed or set, the record is removed again rather than
 * lingering as "Empty Description" / "Untitled Document".
 *
 * Only a record that is still exactly as New made it is removed — `isUntouched`
 * decides — so anything entered at all keeps it.
 *
 * Returns `markNew(id)`: call it right after creating the record.
 */
export function useDiscardUntouchedNew<T>(
  activeId: string | null,
  find: (id: string) => T | undefined,
  isUntouched: (record: T | undefined) => boolean,
  remove: (id: string) => void,
) {
  const pendingRef = useRef<string | null>(null);
  const latest = useRef({ find, isUntouched, remove });
  latest.current = { find, isUntouched, remove };

  const discardIfUntouched = (id: string) => {
    const { find: f, isUntouched: u, remove: r } = latest.current;
    if (u(f(id))) r(id);
  };

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || activeId === pending) return;
    pendingRef.current = null;
    discardIfUntouched(pending);
  }, [activeId]);

  useEffect(() => () => {
    const pending = pendingRef.current;
    if (pending) discardIfUntouched(pending);
  }, []);

  return (id: string) => {
    const previous = pendingRef.current;
    if (previous && previous !== id) discardIfUntouched(previous);
    pendingRef.current = id;
  };
}
