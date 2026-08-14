import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { List, ChevronDown } from 'lucide-react';

export interface ReportTocSection {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface ReportTocProps {
  sections: ReportTocSection[];
  activeSectionId?: string;
  onSelectSection?: (id: string) => void;
  className?: string;
  navigationLabel?: string;
  title?: string;
  toggleLabel?: string;
  activeSectionPrefix?: string;
  selectSectionLabel?: string;
}

const getScrollRoot = (element: Element | null): Element | null => {
  let current = element?.parentElement ?? null;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

export const ReportToc: React.FC<ReportTocProps> = ({
  sections,
  activeSectionId: controlledActiveId,
  onSelectSection,
  className = '',
  navigationLabel = '报告目录导航',
  title = '报告目录',
  toggleLabel = '切换报告目录',
  activeSectionPrefix = '目录',
  selectSectionLabel = '选择章节',
}) => {
  const [internalActiveId, setInternalActiveId] = useState<string>(
    controlledActiveId || sections[0]?.id || ''
  );
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const activeId = controlledActiveId || internalActiveId;

  // Set up IntersectionObserver to detect which section is in view
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    const firstSectionElement = sections
      .map((section) => document.getElementById(section.id))
      .find((element): element is HTMLElement => element !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((e) => e.isIntersecting);
        if (visibleEntries.length > 0) {
          visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          const topVisible = visibleEntries[0];
          setInternalActiveId(topVisible.target.id);
        }
      },
      {
        root: getScrollRoot(firstSectionElement ?? null),
        rootMargin: '-10% 0px -60% 0px',
        threshold: [0, 0.2, 0.5, 0.8],
      }
    );

    sections.forEach((sec) => {
      const el = document.getElementById(sec.id);
      if (el) {
        observer.observe(el);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [sections]);

  const handleScrollTo = useCallback(
    (id: string) => {
      setInternalActiveId(id);
      onSelectSection?.(id);
      setIsMobileOpen(false);

      const el = document.getElementById(id);
      if (el) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
    },
    [onSelectSection]
  );

  const activeSection = sections.find((s) => s.id === activeId) || sections[0];

  return (
    <nav
      aria-label={navigationLabel}
      className={`relative lg:sticky lg:top-20 lg:self-start ${className}`}
    >
      {/* Mobile Collapsible Dropdown */}
      <div className="lg:hidden mb-4">
        <button
          type="button"
          onClick={() => setIsMobileOpen((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-xl border border-border/80 bg-card/90 px-3.5 py-2.5 text-xs font-semibold text-foreground shadow-sm transition-all hover:bg-hover"
          aria-expanded={isMobileOpen}
          aria-label={toggleLabel}
        >
          <div className="flex items-center gap-2">
            <List className="h-3.5 w-3.5 text-cyan" />
            <span>{activeSectionPrefix}：{activeSection?.label || selectSectionLabel}</span>
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 text-secondary-text transition-transform duration-200 ${
              isMobileOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isMobileOpen ? (
          <div className="mt-1.5 flex flex-col gap-1 rounded-xl border border-border/80 bg-card/95 p-1.5 shadow-lg animate-fade-in z-20">
            {sections.map((sec) => {
              const isActive = sec.id === activeId;
              const Icon = sec.icon;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => handleScrollTo(sec.id)}
                  aria-current={isActive ? 'location' : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-cyan/15 font-semibold text-cyan'
                      : 'text-secondary-text hover:bg-hover hover:text-foreground'
                  }`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Desktop Sticky Rail */}
      <div className="hidden w-44 shrink-0 space-y-1 rounded-2xl border border-border/60 bg-card/60 p-2.5 shadow-soft-card backdrop-blur-md lg:block">
        <div className="mb-2 flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-text">
          <List className="h-3 w-3 text-cyan" />
          <span>{title}</span>
        </div>
        {sections.map((sec) => {
          const isActive = sec.id === activeId;
          const Icon = sec.icon;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => handleScrollTo(sec.id)}
              aria-current={isActive ? 'location' : undefined}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-all ${
                isActive
                  ? 'border border-cyan/30 bg-cyan/10 font-semibold text-cyan shadow-sm'
                  : 'border border-transparent text-secondary-text hover:bg-hover/60 hover:text-foreground'
              }`}
            >
              {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
              <span className="truncate">{sec.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
