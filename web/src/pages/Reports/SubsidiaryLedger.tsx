// 明细账（Task4）
// 选科目+日期范围，逐笔展示凭证分录，含期初期末余额
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
  Descriptions,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import axios from 'axios';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { listTaxpayers, listAccounts, type TaxpayerSubject, type Account } from '../../api/taxpayer';
import {
  getSubsidiaryLedger,
  type SubsidiaryLedgerEntry,
  type SubsidiaryLedgerResult,
} from '../../api/report';
import { exportToExcel, fmt } from '../../utils/excel';

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;

export default function SubsidiaryLedgerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [data, setData] = useState<SubsidiaryLedgerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [accLoading, setAccLoading] = useState(false);

  // 初始化：拉取纳税人列表，回填 query 参数
  useEffect(() => {
    listTaxpayers()
      .then((res) => setTaxpayers(res.data))
      .catch(() => {
        /* ignore */
      });
    const sid = Number(searchParams.get('subjectId'));
    const aid = Number(searchParams.get('accountId'));
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (sid) setSubjectId(sid);
    if (aid) setAccountId(aid);
    if (from && to) {
      setRange([dayjs(from), dayjs(to)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主体变化时拉取对应科目列表
  useEffect(() => {
    if (!subjectId) {
      setAccounts([]);
      setAccountId(undefined);
      return;
    }
    setAccLoading(true);
    // 仅末级科目可记明细账，按 isLeaf 过滤
    listAccounts(subjectId)
      .then((res) => setAccounts(res.data.filter((a) => a.isLeaf)))
      .catch(() => setAccounts([]))
      .finally(() => setAccLoading(false));
  }, [subjectId]);

  const fetchData = useCallback(async () => {
    if (!subjectId || !accountId) {
      setData(null);
      return;
    }
    const from = range[0].format('YYYY-MM-DD');
    const to = range[1].format('YYYY-MM-DD');
    setLoading(true);
    try {
      const { data: res } = await getSubsidiaryLedger(subjectId, accountId, from, to);
      setData(res);
      setSearchParams(
        {
          subjectId: String(subjectId),
          accountId: String(accountId),
          from,
          to,
        },
        { replace: true }
      );
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [subjectId, accountId, range, setSearchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnsType<SubsidiaryLedgerEntry> = [
    { title: '日期', dataIndex: 'voucherDate', key: 'voucherDate', width: 110 },
    { title: '凭证号', dataIndex: 'voucherNo', key: 'voucherNo', width: 120 },
    { title: '摘要', dataIndex: 'summary', key: 'summary', render: (v: string | null) => v || '-' },
    {
      title: '借方',
      dataIndex: 'debit',
      key: 'debit',
      width: 120,
      align: 'right',
      render: (v: number) => fmt(v),
    },
    {
      title: '贷方',
      dataIndex: 'credit',
      key: 'credit',
      width: 120,
      align: 'right',
      render: (v: number) => fmt(v),
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 130,
      align: 'right',
      render: (v: number) => fmt(v),
    },
  ];

  const handleExport = () => {
    if (!data) return;
    const exRows: (string | number)[][] = [];
    const accLabel = `${data.account.code} ${data.account.name}`;
    const rangeLabel = `${range[0].format('YYYY-MM-DD')} ~ ${range[1].format('YYYY-MM-DD')}`;
    exRows.push(['明细账', accLabel]);
    exRows.push(['日期范围', rangeLabel, '余额方向', data.account.balanceDirection === 'DEBIT' ? '借方' : '贷方']);
    exRows.push([]);
    exRows.push(['日期', '凭证号', '摘要', '借方', '贷方', '余额']);
    // 期初行
    exRows.push(['', '', '期初余额', '', '', data.openingBalance]);
    for (const r of data.entries) {
      exRows.push([r.voucherDate, r.voucherNo, r.summary || '', r.debit, r.credit, r.balance]);
    }
    // 期末行
    exRows.push(['', '', '期末余额', data.totalDebit, data.totalCredit, data.closingBalance]);
    exportToExcel([{ name: '明细账', rows: exRows }], `明细账_${accLabel}_${rangeLabel}.xlsx`);
  };

  return (
    <Card
      title={
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            明细账
          </Title>
          {data && (
            <Text type="secondary">
              {data.account.code} {data.account.name}
            </Text>
          )}
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
          onChange={(v) => {
            setSubjectId(v);
            setAccountId(undefined);
          }}
          options={taxpayers.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择科目"
          style={{ width: 260 }}
          value={accountId}
          loading={accLoading}
          onChange={(v) => setAccountId(v)}
          options={accounts.map((a) => ({
            value: a.id,
            label: `${a.code} ${a.name}`,
          }))}
        />
        <RangePicker value={range} onChange={(v) => v && setRange([v[0] as Dayjs, v[1] as Dayjs])} />
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : data ? (
        <>
          <Descriptions size="small" bordered column={4} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="科目编码">{data.account.code}</Descriptions.Item>
            <Descriptions.Item label="科目名称">{data.account.name}</Descriptions.Item>
            <Descriptions.Item label="余额方向">
              {data.account.balanceDirection === 'DEBIT' ? '借方' : '贷方'}
            </Descriptions.Item>
            <Descriptions.Item label="凭证笔数">{data.entries.length}</Descriptions.Item>
            <Descriptions.Item label="期初余额">{fmt(data.openingBalance)}</Descriptions.Item>
            <Descriptions.Item label="借方合计">{fmt(data.totalDebit)}</Descriptions.Item>
            <Descriptions.Item label="贷方合计">{fmt(data.totalCredit)}</Descriptions.Item>
            <Descriptions.Item label="期末余额">{fmt(data.closingBalance)}</Descriptions.Item>
          </Descriptions>
          {data.entries.length === 0 ? (
            <Alert type="info" showIcon message="所选日期范围内无凭证分录" />
          ) : (
            <Table<SubsidiaryLedgerEntry>
              rowKey={(r) => r.voucherId}
              columns={columns}
              dataSource={data.entries}
              pagination={false}
              size="small"
              scroll={{ x: 720 }}
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}>
                      <Text strong>合计</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Text strong>{fmt(data.totalDebit)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{fmt(data.totalCredit)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Text strong>{fmt(data.closingBalance)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          )}
        </>
      ) : (
        <Text type="secondary">请选择纳税人主体、科目和日期范围后查看明细账</Text>
      )}
    </Card>
  );
}
