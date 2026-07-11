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
  // 新手友好：大白话描述（含 {metricValue}/{thresholdValue} 占位符）+ 改正步骤（JSON 数组字符串）
  plainDescription: string;
  fixSteps: string;
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
    plainDescription:
      '你公司本月增值税税负率仅{metricValue}，低于行业预警值{thresholdValue}，税局会怀疑你少缴增值税',
    fixSteps:
      '["1.核查销项发票是否全部开具申报","2.核查大额进项发票是否真实业务","3.若虚开进项立即作废并做进项转出"]',
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
    plainDescription:
      '你公司本月进项税额比上月增长{metricValue}，远超正常水平，税局会重点核查',
    fixSteps:
      '["1.逐笔核查新增大额进项发票","2.确认每张进项对应真实采购","3.保留采购合同入库单付款凭证","4.不合规进项做转出处理"]',
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
    plainDescription:
      '你公司本月成本占收入比例高达{metricValue}，明显偏高，税局会怀疑虚增成本',
    fixSteps:
      '["1.核查大额成本凭证是否真实","2.确认成本归集是否准确","3.调整不合理成本入账"]',
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
    plainDescription:
      '你公司本月发票作废率{metricValue}偏高，存在虚开嫌疑',
    fixSteps:
      '["1.核查作废原因是否合理","2.确认无连号或顶额开票","3.规范开票流程"]',
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
    plainDescription:
      '你公司账面库存与发票进销逻辑偏离{metricValue}，可能账实不符',
    fixSteps:
      '["1.盘点实际库存与账面核对","2.查找差异原因","3.做盘盈盘亏处理"]',
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
    plainDescription:
      '你公司存在资金回流/私户收款现象，税局会怀疑隐瞒收入',
    fixSteps:
      '["1.核查资金回流对手方","2.公对公结算避免私户收款","3.补充真实业务合同"]',
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
    plainDescription:
      '你公司关联交易定价偏离正常水平{metricValue}，可能被认定转移利润',
    fixSteps:
      '["1.核查关联交易定价是否符合独立交易原则","2.准备同期资料","3.调整关联定价至公允水平"]',
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
    plainDescription:
      '你公司连续{metricValue}期零申报或微利，税局会重点监控',
    fixSteps:
      '["1.确认零申报是否真实","2.若有收入未入账立即补记补报","3.避免长期零申报"]',
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
    plainDescription:
      '你公司期末留抵税额占进项比例{metricValue}，留抵过大，税局会核查',
    fixSteps:
      '["1.核查大额留抵形成原因","2.确认进项真实且用于应税项目","3.加快销售实现销项抵扣"]',
  },
];
