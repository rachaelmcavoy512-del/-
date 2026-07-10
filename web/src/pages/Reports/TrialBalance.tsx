// 试算平衡表（Task4）
// 列：科目编码/名称/期初借/期初贷/本期借发生/本期贷发生/期末借/期末贷
import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Typography,
  Alert,
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
  getTrialBalance,
  type TrialBalanceRow,
  type TrialBalanceResult,
} from '../../api/report';
import { exportToExcel, fmt } from '../../utils/excel';

const { Title, Text } = Typography;

export default function TrialBalancePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [data, setData] = useState<TrialBalanceResult | null>(null);
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
    if (sid) setSubjectId(sid);
    if (y && p) setMonth(dayjs(`${y}-${String(p).padStart(2, '0')}-01`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(async () => {
    if (!subjectId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const { data: res } = await getTrialBalance(subjectId, month.year(), month.month() + 1);
      setData(res);
      setSearchParams(
        {
          subjectId: String(subjectId),
          year: String(month.year()),
          period: String(month.month() + 1),
        },
        { replace: true }
      );
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [subjectId, month, setSearchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnsType<TrialBalanceRow> = [
    { title: '科目编码', dataIndex: ['account', 'code'], key: 'code', width: 100 },
    { title: '科目名称', dataIndex: ['account', 'name'], key: 'name' },
    { title: '期初借方', dataIndex: 'openingDebit', key: 'openingDebit', width: 120, align: 'right', render: (v: number) => fmt(v) },
    { title: '期初贷方', dataIndex: 'openingCredit', key: 'openingCredit', width: 120, align: 'right', render: (v: number) => fmt(v) },
    { title: '本期借方发生', dataIndex: 'periodDebit', key: 'periodDebit', width: 130, align: 'right', render: (v: number) => fmt(v) },
    { title: '本期贷方发生', dataIndex: 'periodCredit', key: 'periodCredit', width: 130, align: 'right', render: (v: number) => fmt(v) },
    { title: '期末借方', dataIndex: 'closingDebit', key: 'closingDebit', width: 120, align: 'right', render: (v: number) => fmt(v) },
    { title: '期末贷方', dataIndex: 'closingCredit', key: 'closingCredit', width: 120, align: 'right', render: (v: number) => fmt(v) },
  ];

  const handleExport = () => {
    if (!data) return;
    const exRows: (string | number)[][] = [];
    exRows.push(['试算平衡表', data.periodLabel]);
    exRows.push([]);
    exRows.push(['科目编码', '科目名称', '期初借方', '期初贷方', '本期借方发生', '本期贷方发生', '期末借方', '期末贷方']);
    for (const r of data.rows) {
      exRows.push([
        r.account.code,
        r.account.name,
        r.openingDebit,
        r.openingCredit,
        r.periodDebit,
        r.periodCredit,
        r.closingDebit,
        r.closingCredit,
      ]);
    }
    exRows.push([]);
    exRows.push(['合计', '', data.totalOpeningDebit, data.totalOpeningCredit, data.totalPeriodDebit, data.totalPeriodCredit, data.totalClosingDebit, data.totalClosingCredit]);
    exRows.push([]);
    exRows.push(['借方合计', data.totalPeriodDebit, '贷方合计', data.totalPeriodCredit, '平衡校验', data.balanced ? '平衡 ✓' : '不平衡 ✗']);
    exportToExcel([{ name: '试算平衡表', rows: exRows }], `试算平衡表_${data.periodLabel}.xlsx`);
  };

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            试算平衡表
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
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : data ? (
        <>
          {data.balanced ? (
            <Alert
              type="success"
              showIcon
              message={`试算平衡：本期借方合计 ${fmt(data.totalPeriodDebit)} = 贷方合计 ${fmt(data.totalPeriodCredit)}`}
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Alert
              type="error"
              showIcon
              message={`试算不平衡！本期借方合计 ${fmt(data.totalPeriodDebit)} ≠ 贷方合计 ${fmt(data.totalPeriodCredit)}`}
              style={{ marginBottom: 16 }}
            />
          )}
          <Table<TrialBalanceRow>
            rowKey={(r) => r.account.id}
            columns={columns}
            dataSource={data.rows}
            pagination={false}
            size="small"
            scroll={{ x: 1000 }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}>
                    <Text strong>合计</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><Text strong>{fmt(data.totalOpeningDebit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><Text strong>{fmt(data.totalOpeningCredit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><Text strong>{fmt(data.totalPeriodDebit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><Text strong>{fmt(data.totalPeriodCredit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><Text strong>{fmt(data.totalClosingDebit)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right"><Text strong>{fmt(data.totalClosingCredit)}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </>
      ) : (
        <Text type="secondary">请选择纳税人主体和期间后查看报表</Text>
      )}
    </Card>
  );
}
