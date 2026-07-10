// 风险指标库初始化数据（Task7 税务风险监控）
// 内置 9 类风险指标，与产品规格一致
//
// 阈值 JSON 说明（thresholdHigh/Medium/Low）：
//   - {lt: 0.01}        表示实际值 < 0.01 时命中
//   - {gt: 0.5}         表示实际值 > 0.5 时命中
//   - {inputGrowthGt:0.5} 进项税额环比增长 > 50% 命中
//   - {roundTrip: true}  表示存在资金回流命中
//   - {consecutiveZeroGte:3} 连续零申报期数 >= 3 命中
// 等级判定优先级：High > Medium > Low
// severity：当无具体阈值命中时（如 roundTrip 这类布尔命中），用 severity 作为默认等级

export interface RiskIndicatorSeed {
  code: string;
  name: string;
  description: string;
  category: string; // VAT / CIT / INVOICE / FUND / RELATED / OTHER
  thresholdHigh: string; // JSON
  thresholdMedium: string; // JSON
  thresholdLow?: string | null; // JSON
  severity: string; // DEFAULT_HIGH / DEFAULT_MEDIUM
  enabled: boolean;
}

export const RISK_INDICATORS: RiskIndicatorSeed[] = [
  {
    code: 'VAT_TAX_BURDEN',
    name: '增值税税负率异常',
    description:
      '税负率 = 应纳增值税 / 应税销售额。税负率过低可能存在虚增进项、隐瞒收入等风险。',
    category: 'VAT',
    thresholdHigh: JSON.stringify({ lt: 0.01 }),
    thresholdMedium: JSON.stringify({ lt: 0.02 }),
    thresholdLow: null,
    severity: 'DEFAULT_HIGH',
    enabled: true,
  },
  {
    code: 'INPUT_OUTPUT_MISMATCH',
    name: '进销项比对异常',
    description:
      '进项税额环比增长异常偏高，或销项税额与销售收入不匹配，可能存在虚抵进项风险。',
    category: 'VAT',
    thresholdHigh: JSON.stringify({ inputGrowthGt: 0.5 }),
    thresholdMedium: JSON.stringify({ inputGrowthGt: 0.3 }),
    thresholdLow: null,
    severity: 'DEFAULT_HIGH',
    enabled: true,
  },
  {
    code: 'REVENUE_COST_MISMATCH',
    name: '收入成本匹配异常',
    description: '成本率过高或收入成本倒挂，可能存在虚增成本、少计收入等风险。',
    category: 'CIT',
    thresholdHigh: JSON.stringify({ costRatioGt: 0.9 }),
    thresholdMedium: JSON.stringify({ costRatioGt: 0.8 }),
    thresholdLow: null,
    severity: 'DEFAULT_HIGH',
    enabled: true,
  },
  {
    code: 'INVOICE_ABNORMAL',
    name: '发票异常',
    description:
      '发票作废率偏高、顶额开票占比过高或发票连号，可能存在虚开发票风险。',
    category: 'INVOICE',
    thresholdHigh: JSON.stringify({ voidRateGt: 0.1 }),
    thresholdMedium: JSON.stringify({ voidRateGt: 0.05 }),
    thresholdLow: null,
    severity: 'DEFAULT_HIGH',
    enabled: true,
  },
  {
    code: 'INVENTORY_MISMATCH',
    name: '库存账实不符',
    description:
      '账面库存与发票进销逻辑背离（进项-销项对应商品数量与账面库存变动不符）。',
    category: 'VAT',
    thresholdHigh: JSON.stringify({ diffGt: 0.3 }),
    thresholdMedium: JSON.stringify({ diffGt: 0.2 }),
    thresholdLow: null,
    severity: 'DEFAULT_MEDIUM',
    enabled: true,
  },
  {
    code: 'FUND_FLOW_ABNORMAL',
    name: '资金流异常',
    description:
      '资金回流（同一对手方既有收入又有支出且净额接近0）或私户收款，可能存在虚增收入、资金走账风险。',
    category: 'FUND',
    thresholdHigh: JSON.stringify({ roundTrip: true }),
    thresholdMedium: JSON.stringify({ roundTrip: true }),
    thresholdLow: null,
    severity: 'DEFAULT_HIGH',
    enabled: true,
  },
  {
    code: 'RELATED_TRANSACTION',
    name: '关联交易定价异常',
    description: '关联方交易价格偏离独立交易价格，可能存在转让定价避税风险。',
    category: 'RELATED',
    thresholdMedium: JSON.stringify({ deviationGt: 0.2 }),
    thresholdHigh: JSON.stringify({ deviationGt: 0.5 }),
    thresholdLow: null,
    severity: 'DEFAULT_MEDIUM',
    enabled: true,
  },
  {
    code: 'LONG_ZERO_FILING',
    name: '长期零申报/微利申报',
    description: '连续多期零申报或利润率长期偏低，可能存在隐瞒收入、虚列费用风险。',
    category: 'CIT',
    thresholdHigh: JSON.stringify({ consecutiveZeroGte: 3 }),
    thresholdMedium: JSON.stringify({ profitRatioLt: 0.01 }),
    thresholdLow: null,
    severity: 'DEFAULT_HIGH',
    enabled: true,
  },
  {
    code: 'EXCESS_CREDIT',
    name: '期末留抵异常',
    description: '期末留抵税额占进项比例偏高且持续增长，可能存在虚抵进项、迟计销项风险。',
    category: 'VAT',
    thresholdHigh: JSON.stringify({ creditRatioGt: 0.5 }),
    thresholdMedium: JSON.stringify({ creditRatioGt: 0.3 }),
    thresholdLow: null,
    severity: 'DEFAULT_MEDIUM',
    enabled: true,
  },
];
