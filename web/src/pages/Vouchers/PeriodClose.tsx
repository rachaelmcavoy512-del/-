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
  Popconfirm,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';
import {
  getBalances,
  periodClose,
  type AccountBalanceRow,
  type Voucher,
} from '../../api/voucher';

// 科目类别中文标签
const CATEGORY_LABEL: Record<string, string> = {
  ASSET: '资产类',
  LIABILITY: '负债类',
  EQUITY: '所有者权益',
  COST: '成本类',
  INCOME: '损益收入',
  EXPENSE: '损益支出',
};

// 损益类类别：仅这些科目参与期末结转预览
const PNL_CATEGORIES = ['INCOME', 'EXPENSE'];

// 当前登录用户
interface CurrentUser {
  id: number;
  username: string;
  role: string;
}

function getCurrentUser(): CurrentUser | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export default function PeriodClosePage() {
  const navigate = useNavigate();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [rows, setRows] = useState<AccountBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultVoucher, setResultVoucher] = useState<Voucher | null>(null);

  const currentUser = getCurrentUser();
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT';

  // 加载主体下拉
  useEffect(() => {
    listTaxpayers()
      .then((res) => setTaxpayers(res.data))
      .catch(() => {
        /* ignore */
      });
  }, []);

  // 拉取当月损益类科目余额预览
  const fetchPreview = useCallback(async () => {
    if (!subjectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setResultVoucher(null);
    try {
      const { data: res } = await getBalances(subjectId, month.year(), month.month() + 1);
      // 仅展示损益类科目
      setRows(res.items.filter((r) => PNL_CATEGORIES.includes(r.account.category)));
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载余额失败' : '加载余额失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [subjectId, month]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  // 期末结转合计：收入合计 - 支出合计（结转后转入本年利润）
  const incomeTotal = rows
    .filter((r) => r.account.category === 'INCOME')
    .reduce((sum, r) => sum + r.closingBalance, 0);
  const expenseTotal = rows
    .filter((r) => r.account.category === 'EXPENSE')
    .reduce((sum, r) => sum + r.closingBalance, 0);
  const profitTotal = incomeTotal - expenseTotal;

  // 执行期末结转
  const handleClose = async () => {
    if (!subjectId) return;
    setSubmitting(true);
    try {
      const { data: voucher } = await periodClose(subjectId, month.year(), month.month() + 1);
      setResultVoucher(voucher);
      message.success('期末结转成功，已生成结转凭证并自动过账');
      fetchPreview();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '结转失败' : '结转失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<AccountBalanceRow> = [
    { title: '科目编码', dataIndex: ['account', 'code'], key: 'code', width: 120 },
    { title: '科目名称', dataIndex: ['account', 'name'], key: 'name' },
    {
      title: '类别',
      dataIndex: ['account', 'category'],
      key: 'category',
      width: 110,
      render: (v: string) => CATEGORY_LABEL[v] ?? v,
    },
    {
      title: '方向',
      dataIndex: ['account', 'balanceDirection'],
      key: 'balanceDirection',
      width: 80,
      render: (v: string) => (v === 'DEBIT' ? '借' : '贷'),
    },
    {
      title: '本期借方发生',
      dataIndex: 'periodDebit',
      key: 'periodDebit',
      width: 140,
      align: 'right',
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '本期贷方发生',
      dataIndex: 'periodCredit',
      key: 'periodCredit',
      width: 140,
      align: 'right',
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '期末余额',
      dataIndex: 'closingBalance',
      key: 'closingBalance',
      width: 140,
      align: 'right',
      render: (v: number) => v.toFixed(2),
    },
  ];

  return (
    <Card
      title="期末损益结转"
      extra={
        <Button onClick={() => navigate('/vouchers')}>返回凭证列表</Button>
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
        <Typography.Text type="secondary">
          结转后损益类科目余额归零，差额转入本年利润(4103)
        </Typography.Text>
      </Space>

      {!canManage && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="仅管理员/会计可执行期末结转"
        />
      )}

      {resultVoucher && (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          showIcon
          message={`结转凭证 ${resultVoucher.voucherNo} 已生成并自动过账`}
          description={
            <Button type="link" size="small" onClick={() => navigate(`/vouchers/${resultVoucher.id}`)}>
              查看结转凭证详情
            </Button>
          }
        />
      )}

      <Table<AccountBalanceRow>
        rowKey={(r) => r.account.id}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 900 }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <Typography.Text strong>合计</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Typography.Text>收入：{incomeTotal.toFixed(2)}</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Typography.Text>支出：{expenseTotal.toFixed(2)}</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <Typography.Text strong>
                  净利润：{profitTotal.toFixed(2)}
                </Typography.Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />

      <Space style={{ marginTop: 16 }}>
        {canManage && (
          <Popconfirm
            title="确定执行期末结转吗？"
            description="将生成结转凭证并自动过账，结转后不可重复"
            onConfirm={handleClose}
            disabled={!subjectId || submitting}
          >
            <Button type="primary" loading={submitting} disabled={!subjectId}>
              执行期末结转
            </Button>
          </Popconfirm>
        )}
        <Button onClick={fetchPreview} disabled={!subjectId}>
          刷新预览
        </Button>
      </Space>
    </Card>
  );
}
