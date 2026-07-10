// 资产负债表（Task4）
// 左右两栏布局（资产 | 负债和所有者权益），显示项目/行次/期末余额
// 底部显示资产合计 vs 负债+权益合计，不平衡时红色提示
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
import { getBalanceSheet, type BalanceSheetItem, type BalanceSheetResult } from '../../api/report';
import { exportToExcel, fmt } from '../../utils/excel';

const { Title, Text } = Typography;

export default function BalanceSheetPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [data, setData] = useState<BalanceSheetResult | null>(null);
  const [loading, setLoading] = useState(false);

  // 初始化：从 URL 读取参数
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
      const { data: res } = await getBalanceSheet(subjectId, month.year(), month.month() + 1);
      setData(res);
      // 同步 URL 参数
      setSearchParams(
        { subjectId: String(subjectId), year: String(month.year()), period: String(month.month() + 1) },
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

  const columns: ColumnsType<BalanceSheetItem> = [
    { title: '行次', dataIndex: 'lineNo', key: 'lineNo', width: 60, align: 'center' },
    { title: '项目', key: 'name', render: (_: unknown, r: BalanceSheetItem) => (
      <span>
        {r.computed ? <Text strong>{r.name}</Text> : `${r.code} ${r.name}`}
      </span>
    ) },
    {
      title: '期末余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 150,
      align: 'right',
      render: (v: number, r: BalanceSheetItem) =>
        r.computed ? <Text strong>{fmt(v)}</Text> : fmt(v),
    },
  ];

  // 导出 Excel
  const handleExport = () => {
    if (!data) return;
    const rows: (string | number)[][] = [];
    rows.push(['资产负债表', data.periodLabel]);
    rows.push([]);
    rows.push(['资产', '', '', '负债和所有者权益', '', '']);
    rows.push(['行次', '项目', '期末余额', '行次', '项目', '期末余额']);
    const maxLen = Math.max(data.assets.length, data.liabilities.length + data.equities.length);
    for (let i = 0; i < maxLen; i++) {
      const a = data.assets[i];
      const l = data.liabilities[i];
      const e = data.equities[i - data.liabilities.length];
      rows.push([
        a ? a.lineNo : '',
        a ? `${a.code} ${a.name}` : '',
        a ? a.balance : '',
        l ? l.lineNo : e ? e.lineNo : '',
        l ? `${l.code} ${l.name}` : e ? e.name : '',
        l ? l.balance : e ? e.balance : '',
      ]);
    }
    rows.push([]);
    rows.push(['', '资产合计', data.totalAssets, '', '负债合计', data.totalLiabilities]);
    rows.push(['', '', '', '', '所有者权益合计', data.totalEquity]);
    rows.push(['', '', '', '', '负债和所有者权益合计', data.totalLiabilities + data.totalEquity]);
    rows.push([]);
    rows.push(['平衡校验', data.balanced ? '平衡 ✓' : '不平衡 ✗']);
    exportToExcel([{ name: '资产负债表', rows }], `资产负债表_${data.periodLabel}.xlsx`);
  };

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            资产负债表
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
              message={`资产负债表平衡：资产合计 ${fmt(data.totalAssets)} = 负债合计 ${fmt(
                data.totalLiabilities
              )} + 所有者权益合计 ${fmt(data.totalEquity)}`}
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Alert
              type="error"
              showIcon
              message={`资产负债表不平衡！资产合计 ${fmt(data.totalAssets)} ≠ 负债合计 ${fmt(
                data.totalLiabilities
              )} + 所有者权益合计 ${fmt(data.totalEquity)}（差额 ${fmt(
                data.totalAssets - (data.totalLiabilities + data.totalEquity)
              )}）`}
              style={{ marginBottom: 16 }}
            />
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 360 }}>
              <Table<BalanceSheetItem>
                rowKey={(r) => `a-${r.code}`}
                columns={columns}
                dataSource={data.assets}
                pagination={false}
                size="small"
                title={() => <Text strong>资产</Text>}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} />
                      <Table.Summary.Cell index={1}>
                        <Text strong>资产合计</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Text strong>{fmt(data.totalAssets)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            </div>
            <div style={{ flex: 1, minWidth: 360 }}>
              <Table<BalanceSheetItem>
                rowKey={(r) => `l-${r.code}`}
                columns={columns}
                dataSource={[...data.liabilities, ...data.equities]}
                pagination={false}
                size="small"
                title={() => <Text strong>负债和所有者权益</Text>}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} />
                      <Table.Summary.Cell index={1}>
                        <Text strong>负债合计</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Text strong>{fmt(data.totalLiabilities)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} />
                      <Table.Summary.Cell index={1}>
                        <Text strong>所有者权益合计</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Text strong>{fmt(data.totalEquity)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} />
                      <Table.Summary.Cell index={1}>
                        <Text strong>负债和所有者权益合计</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Text strong>{fmt(data.totalLiabilities + data.totalEquity)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            </div>
          </div>
        </>
      ) : (
        <Text type="secondary">请选择纳税人主体和期间后查看报表</Text>
      )}
    </Card>
  );
}
