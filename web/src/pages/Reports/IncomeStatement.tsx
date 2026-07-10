// 利润表（Task4）
// 单栏表格，收入项在上支出项在下，小计行加粗
import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Radio,
  Typography,
  Spin,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import axios from 'axios';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';
import {
  getIncomeStatement,
  type IncomeStatementResult,
  type RangeType,
} from '../../api/report';
import { exportToExcel, fmt } from '../../utils/excel';

const { Title, Text } = Typography;

// 合并行类型：科目明细行 + 小计行
interface Row {
  key: string;
  label: string;
  amount?: number;
  bold?: boolean;
  isSection?: boolean;
}

export default function IncomeStatementPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [rangeType, setRangeType] = useState<RangeType>('MONTH');
  const [data, setData] = useState<IncomeStatementResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listTaxpayers()
      .then((res) => setTaxpayers(res.data))
      .catch(() => {
        /* ignore */
      });
    const sid = Number(searchParams.get('subjectId'));
    const y = Number(searchParams.get('year'));
    const p = Number(searchParams.get('period'));
    const rt = searchParams.get('rangeType') as RangeType | null;
    if (sid) setSubjectId(sid);
    if (y && p) setMonth(dayjs(`${y}-${String(p).padStart(2, '0')}-01`));
    if (rt) setRangeType(rt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    if (!subjectId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const { data: res } = await getIncomeStatement(
        subjectId,
        month.year(),
        month.month() + 1,
        rangeType
      );
      setData(res);
      setSearchParams(
        {
          subjectId: String(subjectId),
          year: String(month.year()),
          period: String(month.month() + 1),
          rangeType,
        },
        { replace: true }
      );
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [subjectId, month, rangeType, setSearchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 构造展示行：收入项 → 营业收入小计 → 支出项 → 各小计
  const rows: Row[] = data
    ? [
        ...data.incomes.map((it) => ({ key: `i-${it.code}`, label: `${it.code} ${it.name}`, amount: it.amount })),
        { key: 'sub-rev', label: '一、营业收入', amount: data.operatingRevenue, bold: true },
        ...data.expenses
          .filter((it) => it.code !== '6711' && it.code !== '6801')
          .map((it) => ({ key: `e-${it.code}`, label: `${it.code} ${it.name}`, amount: it.amount })),
        { key: 'sub-cost', label: '减：营业成本', amount: data.operatingCost, bold: true },
        { key: 'sub-period', label: '减：期间费用', amount: data.periodExpenses, bold: true },
        { key: 'sub-op', label: '二、营业利润', amount: data.operatingProfit, bold: true },
        ...data.expenses
          .filter((it) => it.code === '6711')
          .map((it) => ({ key: `e-${it.code}`, label: `${it.code} ${it.name}`, amount: it.amount })),
        { key: 'sub-total', label: '三、利润总额', amount: data.totalProfit, bold: true },
        ...data.expenses
          .filter((it) => it.code === '6801')
          .map((it) => ({ key: `e-${it.code}`, label: `${it.code} ${it.name}`, amount: it.amount })),
        { key: 'sub-net', label: '四、净利润', amount: data.netProfit, bold: true },
      ]
    : [];

  const columns: ColumnsType<Row> = [
    { title: '项目', dataIndex: 'label', key: 'label' },
    {
      title: '本期金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 180,
      align: 'right',
      render: (v: number | undefined, r: Row) =>
        r.bold ? <Text strong>{fmt(v)}</Text> : fmt(v),
    },
  ];

  const handleExport = () => {
    if (!data) return;
    const exRows: (string | number)[][] = [];
    exRows.push(['利润表', data.periodLabel]);
    exRows.push([]);
    exRows.push(['项目', '本期金额']);
    for (const r of rows) {
      exRows.push([r.label, r.amount ?? '']);
    }
    exportToExcel([{ name: '利润表', rows: exRows }], `利润表_${data.periodLabel}.xlsx`);
  };

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            利润表
          </Title>
          {data && <Text type="secondary">{data.periodLabel}</Text>}
        </Space>
      }
      extra={
        <Space>
          <Button onClick={() => navigate('/reports')}>返回报表中心</Button>
          <Button onClick={fetchData}>刷新</Button>
          <Button type="primary" onClick={handleExport} disabled={!data}>
            导出Excel
          </Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择纳税人主体"
          style={{ width: 260 }}
          value={subjectId}
          onChange={(v) => setSubjectId(v)}
          options={taxpayers.map((t) => ({ value: t.id, label: t.name }))}
        />
        <DatePicker
          picker="month"
          value={month}
          onChange={(v) => v && setMonth(v)}
          allowClear={false}
        />
        <Radio.Group value={rangeType} onChange={(e) => setRangeType(e.target.value as RangeType)}>
          <Radio.Button value="MONTH">单月</Radio.Button>
          <Radio.Button value="QUARTER">季度</Radio.Button>
          <Radio.Button value="YEAR">年度</Radio.Button>
        </Radio.Group>
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : data ? (
        <Table<Row>
          rowKey="key"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
          style={{ maxWidth: 700 }}
        />
      ) : (
        <Text type="secondary">请选择纳税人主体和期间后查看报表</Text>
      )}
    </Card>
  );
}
