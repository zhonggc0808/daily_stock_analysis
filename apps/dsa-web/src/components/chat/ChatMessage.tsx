import type React from 'react';
import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BarChart2, Bookmark, BookmarkCheck, Check, Copy, Download, Zap } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Badge } from '../common/Badge';
import { extractStockCodesFromMessage } from '../../utils/chatStockCode';
import { areStockCodesEquivalent, normalizeStockCode } from '../../utils/stockCode';
import { useUiLanguage } from '../../contexts/UiLanguageContext';
import type { Message, ProgressStep } from '../../stores/agentChatStore';
import type { StockIndexItem } from '../../types/stockIndex';

export interface ChatMessageProps {
  msg: Message;
  skillLabel?: string | null;
  backendBadgeText?: string | null;
  isExpandedThinking?: boolean;
  copied?: boolean;
  stockIndex?: StockIndexItem[];
  isStockInWatchlist?: (code: string) => boolean;
  onToggleThinking?: (msgId: string) => void;
  onCopy?: (msgId: string, content: string) => void;
  onExport?: (msg: Message) => void;
  onAnalyzeStock?: (code: string) => void;
  onToggleWatchlist?: (code: string) => void;
  renderThinkingBlock?: (msg: Message) => React.ReactNode;
  renderThinkingDetails?: (steps: ProgressStep[]) => React.ReactNode;
  copyLabel?: string;
  copiedLabel?: string;
}

const removeNonProseMarkdown = (content: string): string => content
  .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
  .replace(/`[^`\n]*`/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/https?:\/\/\S+/g, ' ');

export const ChatMessage: React.FC<ChatMessageProps> = ({
  msg,
  skillLabel,
  backendBadgeText,
  isExpandedThinking,
  copied = false,
  stockIndex = [],
  isStockInWatchlist,
  onCopy,
  onExport,
  onAnalyzeStock,
  onToggleWatchlist,
  renderThinkingBlock,
  renderThinkingDetails,
  copyLabel,
  copiedLabel,
}) => {
  const { t } = useUiLanguage();
  const resolvedCopyLabel = copyLabel ?? t('common.copy');
  const resolvedCopiedLabel = copiedLabel ?? t('common.copied');
  // Extract recognized stock codes from assistant message content
  const detectedStockCodes = useMemo(() => {
    if (msg.role !== 'assistant' || !msg.content) return [];
    return extractStockCodesFromMessage(removeNonProseMarkdown(msg.content));
  }, [msg.role, msg.content]);

  // Map codes to display info
  const stockReferences = useMemo(() => {
    if (!Array.isArray(stockIndex) || stockIndex.length === 0) return [];
    const references = detectedStockCodes.flatMap((code) => {
      const match = stockIndex.find(
        (item) =>
          item.active &&
          typeof item.canonicalCode === 'string' &&
          areStockCodesEquivalent(item.canonicalCode, code)
      );
      return match ? [{
        code: normalizeStockCode(match.canonicalCode),
        name: match?.nameZh || match?.nameEn || '',
      }] : [];
    });
    return references.filter((reference, index) => (
      references.findIndex((item) => item.code === reference.code) === index
    ));
  }, [detectedStockCodes, stockIndex]);

  return (
    <div
      className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
      data-testid={`chat-message-${msg.id}`}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold shadow-sm transition-all',
          msg.role === 'user' ? 'chat-avatar-user' : 'chat-avatar-ai'
        )}
      >
        {msg.role === 'user' ? 'U' : 'AI'}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          'group/message min-w-0 w-fit max-w-[min(100%,48rem)] overflow-hidden px-5 py-3.5 transition-colors',
          msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'
        )}
      >
        {msg.role === 'assistant' && (skillLabel || backendBadgeText) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {skillLabel ? (
              <Badge variant="info" className="chat-skill-badge shadow-none" aria-label={`技能 ${skillLabel}`}>
                <Zap className="w-3 h-3" />
                {skillLabel}
              </Badge>
            ) : null}
            {backendBadgeText ? (
              <Badge variant={msg.backend === 'codex_app_server' ? 'warning' : 'history'} size="sm">
                {backendBadgeText}
              </Badge>
            ) : null}
          </div>
        )}

        {msg.role === 'assistant' && renderThinkingBlock ? renderThinkingBlock(msg) : null}
        {msg.role === 'assistant' &&
          isExpandedThinking &&
          msg.thinkingSteps &&
          renderThinkingDetails ? renderThinkingDetails(msg.thinkingSteps) : null}

        {msg.role === 'assistant' ? (
          <div className="relative">
            {/* Quick Actions (Copy / Export) */}
            <div className="chat-message-actions">
              <button
                type="button"
                onClick={() => onCopy?.(msg.id, msg.content)}
                className="chat-copy-btn"
                aria-label={copied ? resolvedCopiedLabel : resolvedCopyLabel}
              >
                {copied ? <Check className="h-3 w-3 mr-1 inline" /> : <Copy className="h-3 w-3 mr-1 inline" />}
                {copied ? resolvedCopiedLabel : resolvedCopyLabel}
              </button>
              <button
                type="button"
                onClick={() => onExport?.(msg)}
                className="chat-copy-btn"
                aria-label={t('chat.exportMessage')}
              >
                <Download className="h-3 w-3 mr-1 inline" />
                {t('chat.export')}
              </button>
            </div>

            {/* Markdown Body */}
            <div className="chat-prose pr-20 sm:pr-24">
              <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
            </div>

            {/* Interactive Stock References Pill Bar */}
            {stockReferences.length > 0 && (
              <div className="mt-3.5 border-t border-border/50 pt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted-text">{t('chat.relatedStocks')}</span>
                {stockReferences.map(({ code, name }) => {
                  const inWatchlist = isStockInWatchlist ? isStockInWatchlist(code) : false;
                  return (
                    <div
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/80 px-2.5 py-1 text-xs shadow-soft-card backdrop-blur-sm"
                    >
                      <span className="font-semibold text-foreground">
                        {name ? `${name} ` : ''}
                        <span className="font-mono text-secondary-text">({code})</span>
                      </span>

                      {onAnalyzeStock && (
                        <button
                          type="button"
                          onClick={() => onAnalyzeStock(code)}
                          className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-cyan hover:bg-cyan/10 transition-colors"
                          aria-label={t('chat.analyzeStock', { stock: name || code })}
                        >
                          <BarChart2 className="h-3 w-3" />
                          <span>{t('chat.analyze')}</span>
                        </button>
                      )}

                      {onToggleWatchlist && (
                        <button
                          type="button"
                          onClick={() => onToggleWatchlist(code)}
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                            inWatchlist
                              ? 'text-warning hover:bg-warning/10'
                              : 'text-secondary-text hover:bg-hover hover:text-foreground'
                          }`}
                          aria-label={t(
                            inWatchlist ? 'chat.removeWatchlist' : 'chat.addWatchlist',
                            { stock: name || code }
                          )}
                        >
                          {inWatchlist ? (
                            <>
                              <BookmarkCheck className="h-3 w-3" />
                              <span>{t('chat.inWatchlist')}</span>
                            </>
                          ) : (
                            <>
                              <Bookmark className="h-3 w-3" />
                              <span>{t('chat.addWatchlistShort')}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          msg.content.split('\n').map((line, i) => (
            <p key={i} className="mb-1 last:mb-0 leading-relaxed">
              {line || '\u00A0'}
            </p>
          ))
        )}
      </div>
    </div>
  );
};
