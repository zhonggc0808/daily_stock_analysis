import { describe, expect, it } from 'vitest';
import { sanitizeCsvCell, generateScreeningCsv } from '../screeningCsv';
import type { ScreeningCandidate } from '../../api/screening';

describe('screeningCsv', () => {
  describe('sanitizeCsvCell', () => {
    it('handles empty and null values', () => {
      expect(sanitizeCsvCell(null)).toBe('');
      expect(sanitizeCsvCell(undefined)).toBe('');
      expect(sanitizeCsvCell('')).toBe('');
    });

    it('escapes formulas starting with =, +, -, @, \\t, \\r', () => {
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvCell('+12345')).toBe("'+12345");
      expect(sanitizeCsvCell('-5.6%')).toBe("'-5.6%");
      expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
      expect(sanitizeCsvCell('\ttext')).toBe("'\ttext");
    });

    it('escapes cells containing commas and quotes according to RFC 4180', () => {
      expect(sanitizeCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(sanitizeCsvCell('He said "Hello"')).toBe('"He said ""Hello"""');
      expect(sanitizeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('combines formula escaping and quotes when necessary', () => {
      expect(sanitizeCsvCell('=1+2, then "quote"')).toBe('"\'=1+2, then ""quote"""');
    });
  });

  describe('generateScreeningCsv', () => {
    it('prepends UTF-8 BOM and headers', () => {
      const candidates: ScreeningCandidate[] = [
        {
          rank: 1,
          code: '600519',
          name: '贵州茅台',
          industry: '白酒',
          price: 1800,
          changePct: 2.5,
          score: 95,
          llmScore: 92,
          riskLevel: 'low',
          reason: '高端白酒龙头，现金流充沛',
        } as unknown as ScreeningCandidate,
      ];

      const csv = generateScreeningCsv(candidates, false);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('排名,股票代码,股票名称,所属行业,最新价格,涨跌幅(%),综合评分,LLM评分,风险等级,操作信号,核心理由');
      expect(csv).toContain('1,600519,贵州茅台,白酒,1800,2.5%,95,92,low,-,高端白酒龙头，现金流充沛');
    });

    it('supports ETF market header', () => {
      const candidates: ScreeningCandidate[] = [
        {
          rank: 1,
          code: '510300',
          name: '沪深300ETF',
          themeName: '宽基指数',
          price: 3.5,
          changePct: 0.5,
          score: 88,
          llmScore: 85,
          riskLevel: 'low',
          reason: '大盘核心资产',
        } as unknown as ScreeningCandidate,
      ];

      const csv = generateScreeningCsv(candidates, true);
      expect(csv).toContain('主题板块');
      expect(csv).toContain('510300,沪深300ETF,宽基指数');
    });

    it('uses English headers for an English UI export', () => {
      const csv = generateScreeningCsv([], false, 'en');

      expect(csv).toContain('Rank,Stock Code,Stock Name,Industry,Latest Price,Change (%)');
      expect(csv).not.toContain('股票代码');
    });

    it('does not invent risk or signal values when the normalized fields are absent', () => {
      const csv = generateScreeningCsv([{
        rank: 1,
        code: '600000',
        name: '浦发银行',
        reason: '示例',
        raw: { action: 'buy' },
      } as ScreeningCandidate]);

      expect(csv).toContain('600000,浦发银行,-,-,-,-,-,-,-,示例');
      expect(csv).not.toContain('medium');
      expect(csv).not.toContain('buy');
    });
  });
});
