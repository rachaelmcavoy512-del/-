import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Card,
  Form,
  Select,
  DatePicker,
  Input,
  InputNumber,
  Button,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import {
  listTaxpayers,
  listAccounts,
  type TaxpayerSubject,
  type Account,
} from '../../api/taxpayer';
import {
  createVoucher,
  updateVoucher,
  getVoucher,
  type VoucherInput,
} from '../../api/voucher';

// 科目类别标签
const CATEGORY_LABEL: Record<string, string> = {
  ASSET: '资产类',
  LIABILITY: '负债类',
  EQUITY: '所有者权益',
  COST: '成本类',
  INCOME: '损益收入',
  EXPENSE: '损益支出',
};

const CATEGORY_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'COST', 'INCOME', 'EXPENSE'];

// 分录行（本地维护，key 用于 React 渲染）
interface EntryRow {
  key: string;
  accountId: number | undefined;
  summary: string;
  debit: number;
  credit: number;
}

let rowKeySeq = 0;
function newKey(): string {
  rowKeySeq += 1;
  return `row-${Date.now()}-${rowKeySeq}`;
}

export default function VoucherForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit'); // 编辑模式：?edit=:id
  const isEdit = !!editId;

  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [voucherDate, setVoucherDate] = useState<dayjs.Dayjs>(dayjs());
  const [summary, setSummary] = useState('');
  const [attachments, setAttachments] = useState(0);
  const [entries, setEntries] = useState<EntryRow[]>([
    { key: newKey(), accountId: undefined, summary: '', debit: 0, credit: 0 },
    { key: newKey(), accountId: undefined, summary: '', debit: 0, credit: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingVoucher, setLoadingVoucher] = useState(false);

  // 加载主体下拉
  useEffect(() => {
    listTaxpayers()
      .then((res) => setTaxpayers(res.data))
      .catch(() => {
        /* ignore */
      });
  }, []);

  // 编辑模式：加载已有凭证
  useEffect(() => {
    if (!editId) return;
    setLoadingVoucher(true);
    getVoucher(Number(editId))
      .then((res) => {
        const v = res.data;
        setSubjectId(v.subjectId);
        setVoucherDate(dayjs(v.voucherDate));
        setSummary(v.summary ?? '');
        setAttachments(v.attachments ?? 0);
        setEntries(
          v.entries.map((e) => ({
            key: newKey(),
            accountId: e.accountId,
            summary: e.summary ?? '',
            debit: e.debit,
            credit: e.credit,
          }))
        );
      })
      .catch((e) => {
        message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载凭证失败' : '加载凭证失败');
        navigate('/vouchers');
      })
      .finally(() => setLoadingVoucher(false));
  }, [editId, navigate]);

  // 主体变化时加载科目
  const fetchAccounts = useCallback((sid: number) => {
    listAccounts(sid)
      .then((res) => setAccounts(res.data))
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (subjectId) fetchAccounts(subjectId);
    else setAccounts([]);
  }, [subjectId, fetchAccounts]);

  // 科目按类别分组的下拉选项（仅末级科目）
  const accountOptions = useMemo(() => {
    return CATEGORY_ORDER.filter((c) => accounts.some((a) => a.category === c && a.isLeaf)).map(
      (cat) => ({
        label: CATEGORY_LABEL[cat],
        options: accounts
          .filter((a) => a.category === cat && a.isLeaf)
          .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
      })
    );
  }, [accounts]);

  // 借贷合计
  const totals = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const e of entries) {
      d += Number(e.debit) || 0;
      c += Number(e.credit) || 0;
    }
    return { debit: Math.round(d * 100) / 100, credit: Math.round(c * 100) / 100 };
  }, [entries]);

  const balanced = totals.debit === totals.credit && totals.debit > 0;
  const allAccountsSelected = entries.every((e) => e.accountId !== undefined);

  // 分录行操作
  const updateRow = (key: string, patch: Partial<EntryRow>) => {
    setEntries((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    setEntries((prev) => [
      ...prev,
      { key: newKey(), accountId: undefined, summary: '', debit: 0, credit: 0 },
    ]);
  };
  const removeRow = (key: string) => {
    setEntries((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  // 保存
  const handleSave = async () => {
    if (!subjectId) {
      message.warning('请选择纳税人主体');
      return;
    }
    if (entries.length === 0) {
      message.warning('至少需要一条分录');
      return;
    }
    if (!allAccountsSelected) {
      message.warning('请为每条分录选择科目');
      return;
    }
    if (!balanced) {
      message.warning('借贷必须平衡且大于 0');
      return;
    }
    const payload: VoucherInput = {
      voucherDate: voucherDate.format('YYYY-MM-DD'),
      summary: summary || undefined,
      attachments,
      entries: entries.map((e) => ({
        accountId: e.accountId!,
        summary: e.summary || undefined,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
      })),
    };
    setSubmitting(true);
    try {
      if (isEdit && editId) {
        await updateVoucher(Number(editId), payload);
        message.success('修改成功');
        navigate(`/vouchers/${editId}`);
      } else {
        payload.subjectId = subjectId;
        const { data } = await createVoucher(payload);
        message.success(`创建成功，凭证字号：${data.voucherNo}`);
        navigate(`/vouchers/${data.id}`);
      }
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '保存失败' : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<EntryRow> = [
    {
      title: '科目',
      dataIndex: 'accountId',
      key: 'accountId',
      width: 280,
      render: (_: unknown, row: EntryRow) => (
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择末级科目"
          style={{ width: '100%' }}
          value={row.accountId}
          onChange={(v) => updateRow(row.key, { accountId: v })}
          options={accountOptions}
          disabled={!subjectId}
        />
      ),
    },
    {
      title: '摘要',
      dataIndex: 'summary',
      key: 'summary',
      render: (_: unknown, row: EntryRow) => (
        <Input
          value={row.summary}
          onChange={(e) => updateRow(row.key, { summary: e.target.value })}
          placeholder="分录摘要"
          maxLength={200}
        />
      ),
    },
    {
      title: '借方金额',
      dataIndex: 'debit',
      key: 'debit',
      width: 150,
      align: 'right',
      render: (_: unknown, row: EntryRow) => (
        <InputNumber
          value={row.debit || null}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          placeholder="0.00"
          onChange={(v) => updateRow(row.key, { debit: Number(v) || 0 })}
        />
      ),
    },
    {
      title: '贷方金额',
      dataIndex: 'credit',
      key: 'credit',
      width: 150,
      align: 'right',
      render: (_: unknown, row: EntryRow) => (
        <InputNumber
          value={row.credit || null}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          placeholder="0.00"
          onChange={(v) => updateRow(row.key, { credit: Number(v) || 0 })}
        />
      ),
    },
    {
      title: '',
      key: 'action',
      width: 60,
      render: (_: unknown, row: EntryRow) => (
        <Button
          type="text"
          danger
          icon={<MinusCircleOutlined />}
          disabled={entries.length <= 1}
          onClick={() => removeRow(row.key)}
        />
      ),
    },
  ];

  return (
    <Card
      title={isEdit ? '修改凭证' : '新增凭证'}
      loading={loadingVoucher}
      extra={
        <Space>
          <Button onClick={() => navigate(-1)}>返回</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!balanced}
            onClick={handleSave}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item label="纳税人主体" required>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择主体"
            style={{ width: 240 }}
            value={subjectId}
            onChange={(v) => setSubjectId(v)}
            options={taxpayers.map((t) => ({ value: t.id, label: t.name }))}
            disabled={isEdit}
          />
        </Form.Item>
        <Form.Item label="记账日期" required>
          <DatePicker value={voucherDate} onChange={(v) => v && setVoucherDate(v)} />
        </Form.Item>
        <Form.Item label="摘要">
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="凭证摘要"
            maxLength={200}
            style={{ width: 260 }}
          />
        </Form.Item>
        <Form.Item label="附件张数">
          <InputNumber
            value={attachments}
            min={0}
            onChange={(v) => setAttachments(Number(v) || 0)}
          />
        </Form.Item>
      </Form>

      <Table<EntryRow>
        rowKey="key"
        columns={columns}
        dataSource={entries}
        pagination={false}
        size="small"
        scroll={{ x: 800 }}
        footer={() => (
          <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} block>
            添加分录
          </Button>
        )}
      />

      <Space style={{ marginTop: 16, justifyContent: 'flex-end', width: '100%' }} size="large">
        <Typography.Text>
          借方合计：
          <Typography.Text strong>{totals.debit.toFixed(2)}</Typography.Text>
        </Typography.Text>
        <Typography.Text>
          贷方合计：
          <Typography.Text strong>{totals.credit.toFixed(2)}</Typography.Text>
        </Typography.Text>
        <Typography.Text>
          差额：
          <Typography.Text
            strong
            type={balanced ? 'success' : 'danger'}
          >
            {(totals.debit - totals.credit).toFixed(2)}
          </Typography.Text>
        </Typography.Text>
        {!balanced && (
          <Typography.Text type="danger">
            {totals.debit === 0 && totals.credit === 0
              ? '请录入金额'
              : '借贷不平衡，禁止保存'}
          </Typography.Text>
        )}
      </Space>
    </Card>
  );
}
