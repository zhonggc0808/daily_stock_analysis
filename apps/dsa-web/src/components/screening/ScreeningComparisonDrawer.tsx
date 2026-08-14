import type React from 'react';
import { X, ExternalLink, Scale } from 'lucide-react';
import { Drawer } from '../common/Drawer';
import { Button } from '../common/Button';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { ScreeningCandidate } from '../../api/screening';

interface ScreeningComparisonDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCandidates: ScreeningCandidate[];
  onRemoveCandidate: (code: string) => void;
  onAnalyzeCandidate?: (candidate: ScreeningCandidate) => void;
  getSignal?: (candidate: ScreeningCandidate) => string;
  isEtfMarket?: boolean;
}

export const ScreeningComparisonDrawer: React.FC<ScreeningComparisonDrawerProps> = ({
  isOpen,
  onClose,
  selectedCandidates,
  onRemoveCandidate,
  onAnalyzeCandidate,
  getSignal = (candidate) => candidate.signal || '-',
  isEtfMarket = false,
}) => {
  const { t } = useUiLanguage();

  if (!isOpen) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('screening.compare.title')}
      width="max-w-4xl"
    >
      <div className="flex flex-col gap-6 p-4">
        {selectedCandidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Scale className="h-10 w-10 text-muted-text/50" />
            <p className="mt-3 text-sm font-medium text-foreground">{t('screening.compare.emptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-text">{t('screening.compare.emptyDescription')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-left text-sm">
              <tbody>
                {/* 股票代码与名称 */}
                <tr className="border-b border-border/80 bg-surface/50">
                  <td className="w-28 px-4 py-3 font-semibold text-secondary-text">{t('screening.compare.stockInfo')}</td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-foreground">{c.name || '-'}</p>
                          <p className="font-mono text-xs text-secondary-text">{c.code}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveCandidate(c.code)}
                          className="rounded p-1 text-muted-text transition-colors hover:bg-hover hover:text-foreground"
                          aria-label={t('screening.compare.removeStock', { stock: c.name || c.code })}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* 行业/主题 */}
                <tr className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium text-secondary-text">
                    {t(isEtfMarket ? 'screening.compare.themeSector' : 'screening.compare.sector')}
                  </td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3 text-foreground">
                      {isEtfMarket ? c.themeName || '-' : c.industry || '-'}
                    </td>
                  ))}
                </tr>

                {/* 价格与涨跌幅 */}
                <tr className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.priceChange')}</td>
                  {selectedCandidates.map((c) => {
                    const change = Number(c.changePct);
                    const isUp = change > 0;
                    const isDown = change < 0;
                    return (
                      <td key={c.code} className="px-4 py-3 financial-number">
                        <span className="font-semibold text-foreground">
                          {c.price != null ? c.price.toFixed(2) : '-'}
                        </span>
                        {c.changePct != null ? (
                          <span
                            className={`ml-2 text-xs font-semibold ${
                              isUp ? 'text-price-up' : isDown ? 'text-price-down' : 'text-secondary-text'
                            }`}
                          >
                            {isUp ? '+' : ''}
                            {c.changePct.toFixed(2)}%
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>

                {/* 综合评分 */}
                <tr className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.totalScore')}</td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3 font-bold text-cyan financial-number">
                      {c.score != null ? c.score.toFixed(1) : '-'}
                    </td>
                  ))}
                </tr>

                {/* LLM 评分 */}
                <tr className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.llmScore')}</td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3 font-semibold text-foreground financial-number">
                      {c.llmScore != null ? c.llmScore.toFixed(1) : '-'}
                    </td>
                  ))}
                </tr>

                {/* 风险等级 */}
                <tr className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.riskLevel')}</td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
                          c.riskLevel === 'low'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : c.riskLevel === 'high'
                              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                              : c.riskLevel === 'medium'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : 'bg-surface text-secondary-text'
                        }`}
                      >
                        {c.riskLevel === 'low'
                          ? t('screening.risk.low')
                          : c.riskLevel === 'high'
                            ? t('screening.risk.high')
                            : c.riskLevel === 'medium'
                              ? t('screening.risk.medium')
                              : '-'}
                      </span>
                    </td>
                  ))}
                </tr>

                {/* 操作信号 */}
                <tr className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.signal')}</td>
                  {selectedCandidates.map((c) => {
                    const signal = getSignal(c);
                    return (
                      <td key={c.code} className="px-4 py-3 text-xs text-foreground">
                        {signal}
                      </td>
                    );
                  })}
                </tr>

                {/* 核心逻辑 */}
                <tr className="border-b border-border/60 align-top">
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.rationale')}</td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3 text-xs leading-relaxed text-secondary-text">
                      {c.reason || c.llmThesis || c.dsaAnalysisSummary || '-'}
                    </td>
                  ))}
                </tr>

                {/* 操作入口 */}
                <tr>
                  <td className="px-4 py-3 font-medium text-secondary-text">{t('screening.compare.action')}</td>
                  {selectedCandidates.map((c) => (
                    <td key={c.code} className="px-4 py-3">
                      {onAnalyzeCandidate && !isEtfMarket ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            onAnalyzeCandidate(c);
                            onClose();
                          }}
                          className="flex items-center gap-1 text-xs"
                        >
                          <span>{t('screening.compare.analyze')}</span>
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      ) : null}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Drawer>
  );
};
