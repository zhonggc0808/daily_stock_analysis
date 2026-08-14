import React, { Fragment, useState, useMemo } from 'react';
import { Download, Scale, Search, CheckSquare, Square } from 'lucide-react';
import { Button } from '../common/Button';
import { Pagination } from '../common/Pagination';
import { ScreeningComparisonDrawer } from './ScreeningComparisonDrawer';
import { downloadScreeningCsv } from '../../utils/screeningCsv';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { ScreeningCandidate } from '../../api/screening';

interface ScreeningResultsTableProps {
  candidates: ScreeningCandidate[];
  isEtfMarket?: boolean;
  factorRanking?: boolean;
  onAnalyzeCandidate?: (candidate: ScreeningCandidate) => void;
  formatNumber: (value: unknown, digits?: number) => string;
  formatScore: (value: ScreeningCandidate['score']) => string;
  formatPercent: (value: unknown) => string;
  formatAmount: (value: unknown) => string;
  formatEnrichmentSummary: (value: string) => string;
  getRiskLabel: (value?: string) => string;
  getRiskClassName: (value?: string) => string;
  getRiskLabels: (item: ScreeningCandidate) => string[];
  getFactorEntries: (item: ScreeningCandidate) => Array<[string, unknown]>;
  getFactorLabel: (key: string) => string;
  hasLlmInsight: (item: ScreeningCandidate) => boolean;
  getCandidateReason: (item: ScreeningCandidate) => string;
  getSignal: (item: ScreeningCandidate) => string;
}

export const ScreeningResultsTable: React.FC<ScreeningResultsTableProps> = ({
  candidates,
  isEtfMarket = false,
  factorRanking = false,
  onAnalyzeCandidate,
  formatNumber,
  formatScore,
  formatPercent,
  formatAmount,
  formatEnrichmentSummary,
  getRiskLabel,
  getRiskClassName,
  getRiskLabels,
  getFactorEntries,
  getFactorLabel,
  hasLlmInsight,
  getCandidateReason,
  getSignal,
}) => {
  const { language, t } = useUiLanguage();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expandedCode, setExpandedCode] = useState<string | null>(() => candidates[0]?.code ?? null);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);

  // Pagination calculation
  const totalPages = Math.ceil(candidates.length / pageSize) || 1;
  const clampedPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedCandidates = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return candidates.slice(start, start + pageSize);
  }, [candidates, clampedPage, pageSize]);

  // Selected candidate items for comparison
  const selectedCandidates = useMemo(() => {
    return candidates.filter((c) => selectedCodes.has(c.code));
  }, [candidates, selectedCodes]);

  const toggleSelectCandidate = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        if (next.size >= 5) {
          return prev; // Maximum 5 items
        }
        next.add(code);
      }
      return next;
    });
  };

  const handleSelectAllCurrentPage = () => {
    const pageCodes = paginatedCandidates.map((c) => c.code);
    const allSelected = pageCodes.every((code) => selectedCodes.has(code));

    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageCodes.forEach((code) => next.delete(code));
      } else {
        for (const code of pageCodes) {
          if (next.size < 5) {
            next.add(code);
          }
        }
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedCodes(new Set());
  };

  if (candidates.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-soft-card">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-base font-semibold text-foreground">{t('screening.results.title')}</h2>
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs text-secondary-text">
            <Search className="h-4 w-4 text-cyan" />
            {t('screening.results.candidateCount', { count: 0 })}
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-surface/70 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{t('screening.results.empty')}</p>
        </div>
      </section>
    );
  }

  const isPageAllSelected =
    paginatedCandidates.length > 0 &&
    paginatedCandidates.every((c) => selectedCodes.has(c.code));

  return (
    <section className="rounded-2xl border border-border bg-card/95 p-4 shadow-soft-card">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">{t('screening.results.title')}</h2>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-secondary-text">
            <Search className="h-3.5 w-3.5 text-cyan" />
            {t('screening.results.candidateCount', { count: candidates.length })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedCandidates.length > 0 ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={selectedCandidates.length < 2}
                onClick={() => setIsComparisonOpen(true)}
                className="flex items-center gap-1 text-xs"
              >
                <Scale className="h-3.5 w-3.5" />
                <span>{t('screening.results.compareSelected', { count: selectedCandidates.length })}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={clearSelection}
                className="text-xs"
              >
                {t('screening.results.clearSelected')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => downloadScreeningCsv(selectedCandidates, undefined, isEtfMarket, language)}
                className="flex items-center gap-1 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{t('screening.results.exportSelected')}</span>
              </Button>
            </div>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => downloadScreeningCsv(candidates, undefined, isEtfMarket, language)}
            className="flex items-center gap-1 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('screening.results.exportCsv')}</span>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead className="bg-surface text-left text-xs text-secondary-text">
            <tr>
              <th className="w-10 px-3 py-3 text-center">
                <button
                  type="button"
                  onClick={handleSelectAllCurrentPage}
                  className="rounded p-0.5 text-secondary-text hover:text-foreground"
                  aria-label={t('screening.results.selectCurrentPage')}
                >
                  {isPageAllSelected ? (
                    <CheckSquare className="h-4 w-4 text-cyan" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              </th>
              <th className="w-12 px-3 py-3 font-semibold">#</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.code')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.name')}</th>
              <th className="px-4 py-3 font-semibold">{t(isEtfMarket ? 'screening.results.theme' : 'screening.results.industry')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.price')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.change')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.score')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.rankingBasis')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.risk')}</th>
              <th className="px-4 py-3 font-semibold">{t('screening.results.details')}</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCandidates.map((item) => {
              const expanded = expandedCode === item.code;
              const isSelected = selectedCodes.has(item.code);
              const isSelectionFull = selectedCodes.size >= 5 && !isSelected;
              const factors = getFactorEntries(item);
              const llmInsightAvailable = hasLlmInsight(item);
              const dsaWarnings = item.dsaContext?.warnings || [];
              const dsaNews = item.dsaNews || [];
              const dsaEvents = item.dsaEvents || [];
              const riskLabels = getRiskLabels(item);
              const changeNum = Number(item.changePct);

              return (
                <Fragment key={`${item.rank}-${item.code}`}>
                  <tr
                    className={`border-t border-border align-top transition-colors hover:bg-hover/50 ${
                      isSelected ? 'bg-primary/5' : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleSelectCandidate(item.code)}
                        disabled={isSelectionFull}
                        className={`rounded p-0.5 transition-colors ${
                          isSelectionFull
                            ? 'cursor-not-allowed opacity-30 text-muted-text'
                            : isSelected
                              ? 'text-cyan'
                              : 'text-secondary-text hover:text-foreground'
                        }`}
                        aria-label={t('screening.results.compareStock', { stock: item.name || item.code })}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-secondary-text">{item.rank}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-foreground">{item.code}</td>
                    <td className="px-4 py-3 font-semibold text-foreground">{item.name || '-'}</td>
                    <td className="px-4 py-3 text-secondary-text">{isEtfMarket ? item.themeName || '-' : item.industry || '-'}</td>
                    <td className="px-4 py-3 text-secondary-text financial-number">{formatNumber(item.price)}</td>
                    <td
                      className={`px-4 py-3 font-semibold financial-number ${
                        changeNum > 0
                          ? 'text-price-up'
                          : changeNum < 0
                            ? 'text-price-down'
                            : 'text-secondary-text'
                      }`}
                    >
                      {changeNum > 0 ? '+' : ''}
                      {formatNumber(item.changePct)}%
                    </td>
                    <td className="px-4 py-3 font-bold text-cyan financial-number">{formatScore(item.score)}</td>
                    <td className="px-4 py-3 text-secondary-text financial-number">
                      {factorRanking ? t('screening.results.factorRanking') : formatScore(item.llmScore)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${getRiskClassName(item.riskLevel)}`}>
                        {getRiskLabel(item.riskLevel)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="text-sm font-semibold text-cyan transition-colors hover:text-foreground"
                        type="button"
                        onClick={() => setExpandedCode(expanded ? null : item.code)}
                      >
                        {t(expanded ? 'screening.results.collapse' : 'screening.results.expand')}
                      </button>
                    </td>
                  </tr>

                  {expanded ? (
                    <tr className="border-t border-border bg-surface/45">
                      <td colSpan={11} className="px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.summary')}</p>
                              <p className="mt-1 text-sm leading-6 text-foreground">{getCandidateReason(item)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.signal')}</p>
                              <p className="mt-1 text-sm text-foreground">{getSignal(item)}</p>
                              {!isEtfMarket && onAnalyzeCandidate ? (
                                <button
                                  className="mt-2 rounded-lg border border-cyan/40 px-3 py-1.5 text-xs font-semibold text-cyan transition-colors hover:bg-cyan/10"
                                  type="button"
                                  onClick={() => onAnalyzeCandidate(item)}
                                >
                                  {t('screening.results.deepAnalyze')}
                                </button>
                              ) : null}
                            </div>
                            {item.dsaAnalysisSummary ? (
                              <div>
                                <p className="text-xs font-semibold text-secondary-text">{t('screening.results.enrichedSummary')}</p>
                                <p className="mt-1 text-sm leading-6 text-foreground">
                                  {formatEnrichmentSummary(item.dsaAnalysisSummary)}
                                </p>
                              </div>
                            ) : null}
                            {llmInsightAvailable ? (
                              <div>
                                <p className="text-xs font-semibold text-secondary-text">{t('screening.results.aiJudgement')}</p>
                                <p className="mt-1 text-sm leading-6 text-foreground">{item.llmThesis || item.reason}</p>
                                <p className="mt-1 text-xs text-secondary-text">
                                  {t('screening.results.insightMeta', {
                                    sector: item.llmSector || '-',
                                    theme: item.llmTheme || '-',
                                    confidence: formatPercent(item.llmConfidence),
                                  })}
                                </p>
                              </div>
                            ) : null}
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.riskTags')}</p>
                              <p className="mt-1 text-sm text-foreground">
                                {riskLabels.length ? riskLabels.join(language === 'en' ? ', ' : '，') : t('screening.results.none')}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.mainFactors')}</p>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                {factors.length > 0 ? (
                                  factors.map(([key, value]) => (
                                    <div key={key} className="rounded-lg border border-border bg-card px-3 py-2">
                                      <span className="block text-xs text-secondary-text">{getFactorLabel(key)}</span>
                                      <span className="text-sm font-semibold text-foreground financial-number">{formatNumber(value)}</span>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-sm text-secondary-text">{t('screening.results.noFactors')}</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.amount')}</p>
                              <p className="mt-1 text-sm text-foreground financial-number">{formatAmount(item.amount)}</p>
                            </div>
                            {item.llmWatchItems?.length ? (
                              <div>
                                <p className="text-xs font-semibold text-secondary-text">{t('screening.results.watchItems')}</p>
                                <p className="mt-1 text-sm text-foreground">{item.llmWatchItems.join(language === 'en' ? ', ' : '，')}</p>
                              </div>
                            ) : null}
                            {item.llmCatalysts?.length ? (
                              <div>
                                <p className="text-xs font-semibold text-secondary-text">{t('screening.results.catalysts')}</p>
                                <p className="mt-1 text-sm text-foreground">{item.llmCatalysts.join(language === 'en' ? ', ' : '，')}</p>
                              </div>
                            ) : null}
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.news')}</p>
                              {dsaNews.length > 0 ? (
                                <ul className="mt-1 space-y-1 text-sm text-foreground">
                                  {dsaNews.slice(0, 3).map((newsItem: { title?: string; snippet?: string }, newsIndex: number) => (
                                    <li key={`${item.code}-dsa-news-${newsIndex}`}>
                                      {newsItem.title || newsItem.snippet || '-'}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-sm text-secondary-text">{t('screening.results.none')}</p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-secondary-text">{t('screening.results.events')}</p>
                              {dsaEvents.length > 0 ? (
                                <ul className="mt-1 space-y-1 text-sm text-foreground">
                                  {dsaEvents.slice(0, 3).map((eventItem: { title?: string; snippet?: string }, eventIndex: number) => (
                                    <li key={`${item.code}-dsa-event-${eventIndex}`}>
                                      {eventItem.title || eventItem.snippet || '-'}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-1 text-sm text-secondary-text">{t('screening.results.none')}</p>
                              )}
                            </div>
                            {dsaWarnings.length > 0 ? (
                              <div>
                                <p className="text-xs font-semibold text-secondary-text">{t('screening.results.dataWarnings')}</p>
                                <p className="mt-1 text-sm text-secondary-text">{dsaWarnings.join(language === 'en' ? ', ' : '，')}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination and page size bar */}
      <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex items-center gap-3 text-xs text-secondary-text">
          <span>
            {t('screening.results.range', {
              from: (clampedPage - 1) * pageSize + 1,
              to: Math.min(clampedPage * pageSize, candidates.length),
              total: candidates.length,
            })}
          </span>
          <div className="flex items-center gap-1">
            <span>{t('screening.results.perPage')}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan"
            >
              <option value={10}>{t('screening.results.pageSize', { count: 10 })}</option>
              <option value={20}>{t('screening.results.pageSize', { count: 20 })}</option>
              <option value={50}>{t('screening.results.pageSize', { count: 50 })}</option>
            </select>
          </div>
        </div>

        <Pagination
          currentPage={clampedPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Comparison Drawer */}
      <ScreeningComparisonDrawer
        isOpen={isComparisonOpen}
        onClose={() => setIsComparisonOpen(false)}
        selectedCandidates={selectedCandidates}
        onRemoveCandidate={toggleSelectCandidate}
        onAnalyzeCandidate={onAnalyzeCandidate}
        getSignal={getSignal}
        isEtfMarket={isEtfMarket}
      />
    </section>
  );
};
