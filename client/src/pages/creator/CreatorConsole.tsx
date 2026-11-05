import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Permission } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { IconChart, IconFrame, IconLayers, IconShield, IconUsers } from '../../components/icons';
import EmployeesTab from './EmployeesTab';
import LibraryTab from './LibraryTab';
import TemplatesTab from './TemplatesTab';
import { AnalyticsTab, AuditTab } from './InsightsTabs';

const TABS: {
  id: string;
  label: string;
  permission: Permission;
  icon: ComponentType<{ size?: number }>;
  Component: ComponentType;
}[] = [
  {
    id: 'library',
    label: 'Avatar library',
    permission: 'library.manage',
    icon: IconLayers,
    Component: LibraryTab,
  },
  {
    id: 'templates',
    label: 'Templates',
    permission: 'template.manage',
    icon: IconFrame,
    Component: TemplatesTab,
  },
  {
    id: 'employees',
    label: 'Employees',
    permission: 'employee.manage',
    icon: IconUsers,
    Component: EmployeesTab,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    permission: 'analytics.view',
    icon: IconChart,
    Component: AnalyticsTab,
  },
  {
    id: 'audit',
    label: 'Audit log',
    permission: 'audit.view',
    icon: IconShield,
    Component: AuditTab,
  },
];

const TITLES: Record<string, string> = {
  library: 'Avatar Library',
  templates: 'Templates',
  employees: 'Employees',
  analytics: 'Analytics',
  audit: 'Analytics',
};

/**
 * Creator workspace sections. Each sidebar entry opens one section; Analytics also has the
 * audit log as a second tab.
 */
export default function CreatorConsole({ only }: { only?: string[] }) {
  const { can } = useAuth();
  const tabs = TABS.filter((t) => can(t.permission) && (!only || only.includes(t.id)));
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active);

  return (
    <div className="flex flex-col gap-5">
      <div className="px-1">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-2">
          Creator workspace
        </p>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {TITLES[tabs[0]?.id ?? ''] ?? 'Creator workspace'}
        </h1>
      </div>
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Creator workspace"
          className="glass no-scrollbar flex gap-1 overflow-x-auto !rounded-full p-1.5"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              onClick={() => setActive(t.id)}
              className={`relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                t.id === active ? 'text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              {t.id === active && (
                <motion.span
                  layoutId="creator-tab"
                  className="bg-gradient-brand absolute inset-0 -z-10 rounded-full shadow-[var(--shadow-glow)]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
      )}
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            role="tabpanel"
            aria-label={current.label}
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <current.Component />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
