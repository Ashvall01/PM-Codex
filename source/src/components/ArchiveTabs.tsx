import React from 'react';
import { NavLink } from 'react-router-dom';

/**
 * The ACTIVE / ARCHIVE strip that sits under a module's page title.
 *
 * Module-agnostic on purpose — it takes a base path and a count and knows
 * nothing else. See PLAN.md section 20.9.
 *
 * The ACTIVE tab carries `end` so it does not stay lit on the archive route.
 * The left-hand nav in AppLayout.tsx deliberately does the opposite: it has no
 * `end`, so the module stays lit for both tabs.
 */
interface ArchiveTabsProps {
  /** The module's own route, with no trailing slash. For example '/tasks-issues'. */
  basePath: string;
  /** How many records are in the archive for the active project. */
  archivedCount: number;
  /** Wording for the first tab. Defaults to ACTIVE. */
  activeLabel?: string;
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative text-xs uppercase tracking-widest whitespace-nowrap transition-colors duration-200 pb-2',
    isActive ? 'font-black text-qb-black' : 'font-medium text-qb-grey hover:text-qb-dark-grey',
  ].join(' ');

const Underline: React.FC<{ show: boolean }> = ({ show }) =>
  show ? <div className="absolute bottom-0 left-0 w-full h-[2px] bg-qb-orange" /> : null;

export const ArchiveTabs: React.FC<ArchiveTabsProps> = ({
  basePath,
  archivedCount,
  activeLabel = 'Active',
}) => (
  <div className="flex items-center gap-8 border-b border-qb-light-grey mb-8">
    <NavLink to={basePath} end className={tabClass}>
      {({ isActive }) => (
        <>
          <Underline show={isActive} />
          {activeLabel}
        </>
      )}
    </NavLink>
    <NavLink to={`${basePath}/archive`} className={tabClass}>
      {({ isActive }) => (
        <>
          <Underline show={isActive} />
          Archive{archivedCount > 0 ? ` (${archivedCount})` : ''}
        </>
      )}
    </NavLink>
  </div>
);
