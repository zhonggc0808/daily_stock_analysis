import React, { useMemo } from 'react';
import { Activity, FileText, Layers, Newspaper, ShieldCheck, Target } from 'lucide-react';
import type { AnalysisResult, AnalysisReport } from '../../types/analysis';
import { ReportOverview } from './ReportOverview';
import { ReportStrategy } from './ReportStrategy';
import { ReportNews } from './ReportNews';
import { ReportDetails } from './ReportDetails';
import { ReportDiagnostics } from './ReportDiagnostics';
import { AnalysisContextSummary } from './AnalysisContextSummary';
import { MarketReviewReportView } from './MarketReviewReportView';
import { ReportToc, type ReportTocSection } from './ReportToc';
import { getReportText, normalizeReportLanguage } from '../../utils/reportLanguage';

interface ReportSummaryProps {
  data: AnalysisResult | AnalysisReport;
  isHistory?: boolean;
  /** 自选相关 */
  watchlist?: {
    isInWatchlist: (code: string) => boolean;
    onToggle: (code: string) => void;
    isActioning: boolean;
    actionMessage: string | null;
  };
  onOpenRunFlow?: (recordId: number) => void;
}

const REPORT_TOC_COPY = {
  zh: {
    navigationLabel: '报告目录导航', title: '报告目录', toggleLabel: '切换报告目录',
    activeSectionPrefix: '目录', selectSectionLabel: '选择章节',
    overview: '核心概览', strategy: '策略点位', news: '资讯催化', context: '输入数据',
    diagnostics: '运行诊断', details: '透明度追溯',
  },
  en: {
    navigationLabel: 'Report outline', title: 'Report outline', toggleLabel: 'Toggle report outline',
    activeSectionPrefix: 'Section', selectSectionLabel: 'Select a section',
    overview: 'Overview', strategy: 'Strategy levels', news: 'News catalysts', context: 'Input data',
    diagnostics: 'Run diagnostics', details: 'Traceability',
  },
  ko: {
    navigationLabel: '보고서 목차', title: '보고서 목차', toggleLabel: '보고서 목차 전환',
    activeSectionPrefix: '목차', selectSectionLabel: '섹션 선택',
    overview: '핵심 개요', strategy: '전략 가격대', news: '뉴스 촉매', context: '입력 데이터',
    diagnostics: '실행 진단', details: '투명성 추적',
  },
} as const;

/**
 * 完整报告展示组件
 * 按主体内容优先、透明度信息后置的顺序展示报告，支持侧边目录定位。
 */
export const ReportSummary: React.FC<ReportSummaryProps> = ({
  data,
  isHistory = false,
  watchlist,
  onOpenRunFlow,
}) => {
  // 兼容 AnalysisResult 和 AnalysisReport 两种数据格式
  const report: AnalysisReport = 'report' in data ? data.report : data;
  // 使用 report id，因为 queryId 在批量分析时可能重复，且历史报告详情接口需要 recordId 来获取关联资讯和详情数据
  const recordId = report.meta.id;
  const diagnosticSummary = 'diagnosticSummary' in data ? data.diagnosticSummary : undefined;

  const { meta, summary, strategy, details } = report;
  const reportLanguage = normalizeReportLanguage(meta.reportLanguage);
  const tocText = REPORT_TOC_COPY[reportLanguage];
  const text = getReportText(reportLanguage);
  const modelUsed = (meta.modelUsed || '').trim();
  const shouldShowModel = Boolean(
    modelUsed && !['unknown', 'error', 'none', 'null', 'n/a'].includes(modelUsed.toLowerCase()),
  );

  const tocSections: ReportTocSection[] = useMemo(() => [
    { id: 'report-section-overview', label: tocText.overview, icon: FileText },
    { id: 'report-section-strategy', label: tocText.strategy, icon: Target },
    { id: 'report-section-news', label: tocText.news, icon: Newspaper },
    { id: 'report-section-context', label: tocText.context, icon: Layers },
    { id: 'report-section-diagnostics', label: tocText.diagnostics, icon: Activity },
    { id: 'report-section-details', label: tocText.details, icon: ShieldCheck },
  ], [tocText]);

  if (meta.reportType === 'market_review') {
    return (
      <MarketReviewReportView
        report={report}
        recordId={recordId}
        reportLanguage={reportLanguage}
        onOpenRunFlow={onOpenRunFlow}
      />
    );
  }

  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6 animate-fade-in">
      {/* 报告目录导航 (桌面悬浮侧边 / 移动端折叠) */}
      <ReportToc
        sections={tocSections}
        navigationLabel={tocText.navigationLabel}
        title={tocText.title}
        toggleLabel={tocText.toggleLabel}
        activeSectionPrefix={tocText.activeSectionPrefix}
        selectSectionLabel={tocText.selectSectionLabel}
      />

      {/* 报告主体内容 */}
      <div className="flex-1 min-w-0 space-y-5 pb-8">
        {/* 概览区（首屏） */}
        <section id="report-section-overview" aria-label={tocText.overview} className="scroll-mt-24">
          <ReportOverview
            meta={meta}
            summary={summary}
            details={details}
            isHistory={isHistory}
            watchlist={watchlist}
          />
        </section>

        {/* 策略点位区 */}
        <section id="report-section-strategy" aria-label={tocText.strategy} className="scroll-mt-24">
          <ReportStrategy strategy={strategy} language={reportLanguage} />
        </section>

        {/* 资讯区 */}
        <section id="report-section-news" aria-label={tocText.news} className="scroll-mt-24">
          <ReportNews recordId={recordId} limit={8} language={reportLanguage} />
        </section>

        {/* 输入数据块低敏摘要 */}
        <section id="report-section-context" aria-label={tocText.context} className="scroll-mt-24">
          <AnalysisContextSummary
            overview={details?.analysisContextPackOverview}
            language={reportLanguage}
          />
        </section>

        {/* 运行诊断摘要 */}
        <section id="report-section-diagnostics" aria-label={tocText.diagnostics} className="scroll-mt-24">
          <ReportDiagnostics
            recordId={recordId}
            summary={diagnosticSummary}
            language={reportLanguage}
            onOpenRunFlow={onOpenRunFlow}
          />
        </section>

        {/* 透明度与追溯区 */}
        <section id="report-section-details" aria-label={tocText.details} className="scroll-mt-24">
          <ReportDetails details={details} recordId={recordId} language={reportLanguage} />
        </section>

        {/* 分析模型标记（Issue #528）— 报告末尾 */}
        {shouldShowModel && (
          <p className="px-1 text-xs text-muted-text">
            {text.analysisModel}: {modelUsed}
          </p>
        )}
      </div>
    </div>
  );
};
