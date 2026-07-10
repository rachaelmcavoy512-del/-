// 现金流量表（Task4）
// 按三大活动（经营/投资/筹资）分组展示现金流
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
  getCashFlowStatement,
  type CashFlowItem,
  type CashFlowResult,
  type RangeType,
} from '../../api/report';
import { exportToExcel, fmt } from '../../utils/excel';

const { Title, Text } = Typography;

// 展示行：明细 + 小计
interface Row {
  key: string;
  label: string;
  inflow?: number;
  outflow?: number;
  net?: number;
  bold?: boolean;
}

export default function CashFlowStatementPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [rangeType, setRangeType] = useState<RangeType>('MONTH');
  const [data, setData] = useState<CashFlowResult | null>(null);
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
      const { data: res } = await getCashFlowStatement(
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

  // 构造展示行
  const buildRows = (part: { items: CashFlowItem[]; inflow: number; outflow: number; net: number }, prefix: string, sectionTitle: string): Row[] => {
    const r: Row[] = [{ key: `${prefix}-title`, label: sectionTitle, bold: true }];
    for (const it of part.items) {
      r.push({
        key: `${prefix}-${it.code}-${it.name}`,
        label: it.code ? `${it.code} ${it.name}` : it.name,
        inflow: it.inflow,
        outflow: it.outflow,
        net: it.inflow - it.outflow,
      });
    }
    r.push({
      key: `${prefix}-sub`,
      label: '小计',
      inflow: part.inflow,
      outflow: part.outflow,
      net: part.net,
      bold: true,
    });
    return r;
  };

  const rows: Row[] = data
    ? [
        ...buildRows(data.operating, 'op', '一、经营活动产生的现金流量'),
        ...buildRows(data.investing, 'iv', '二、投资活动产生的现金流量'),
        ...buildRows(data.financing, 'fi', '三、筹资活动产生的现金流量'),
        { key: 'net', label: '四、现金及现金等价物净增加额', net: data.netChange, bold: true },
      ]
    : [];

  const columns: ColumnsType<Row> = [
    { title: '项目', dataIndex: 'label', key: 'label', render: (_: unknown, r: Row) => (r.bold ? <Text strong>{r.label}</Text> : r.label) },
    {
      title: '流入',
      dataIndex: 'inflow',
      key: 'inflow',
      width: 140,
      align: 'right',
      render: (v: number | undefined, r: Row) =>
        r.bold ? <Text strong>{v ? fmt(v) : '-'}</Text> : v ? fmt(v) : '-',
    },
    {
      title: '流出',
      dataIndex: 'outflow',
      key: 'outflow',
      width: 140,
      align: 'right',
      render: (v: number | undefined, r: Row) =>
        r.bold ? <Text strong>{v ? fmt(v) : '-'}</Text> : v ? fmt(v) : '-',
    },
    {
      title: '净额',
      dataIndex: 'net',
      key: 'net',
      width: 140,
      align: 'right',
      render: (v: number | undefined, r: Row) =>
        r.bold ? <Text strong>{fmt(v)}</Text> : fmt(v),
    },
  ];

  const handleExport = () => {
    if (!data) return;
    const exRows: (string | number)[][] = [];
    exRows.push(['现金流量表', data.periodLabel]);
    exRows.push([]);
    exRows.push(['项目', '流入', '流出', '净额']);
    for (const r of rows) {
      exRows.push([r.label, r.inflow ?? '', r.outflow ?? '', r.net ?? '']);
    }
    exportToExcel([{ name: '现金流量表', rows: exRows }], `现金流量表_${data.periodLabel}.xlsx`);
  };

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            现金流量表
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
        />
      ) : (
        <Text type="secondary">请选择纳税人主体和期间后查看报表</Text>
      )}
    </Card>
  );
}
