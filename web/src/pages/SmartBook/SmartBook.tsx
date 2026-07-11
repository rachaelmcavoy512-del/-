import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Select,
  Button,
  Tabs,
  Table,
  Tag,
  Space,
  message,
  Spin,
  Empty,
  Popconfirm,
  Typography,
  Input,
  Modal,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ThunderboltOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { listTaxpayers, listAccounts, type TaxpayerSubject, type Account } from '../../api/taxpayer';
import {
  previewBookings,
  generateBookings,
  getPendingReview,
  batchPost,
  getUnidentified,
  assignManualEntry,
  type PreviewBooking,
  type UnidentifiedBankTxn,
} from '../../api/smartBook';
import { postVoucher, type Voucher } from '../../api/voucher';

// 凭证状态颜色
const VOUCHER_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'gold',
  POSTED: 'green',
  VOID: 'default',
  RED_VOID: 'red',
};
const VOUCHER_STATUS_TEXT: Record<string, string> = {
  DRAFT: '草稿',
  POSTED: '已过账',
  VOID: '已作废',
  RED_VOID: '红冲',
};

export default function SmartBook() {
  const [searchParams] = useSearchParams();
  const urlSubjectId = searchParams.get('subjectId');
  const [subjects, setSubjects] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(
    urlSubjectId ? Number(urlSubjectId) : undefined
  );
  const [bookings, setBookings] = useState<PreviewBooking[]>([]);
  const [pendingVouchers, setPendingVouchers] = useState<Voucher[]>([]);
  const [unidentified, setUnidentified] = useState<UnidentifiedBankTxn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<number[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [currentTxn, setCurrentTxn] = useState<UnidentifiedBankTxn | null>(null);
  const [assignAccountId, setAssignAccountId] = useState<number | undefined>();

  // 加载主体列表
  useEffect(() => {
    listTaxpayers()
      .then((res) => {
        setSubjects(res.data);
        // 若 URL 带了 subjectId 则用它，否则取第一个
        if (urlSubjectId) {
          setSubjectId(Number(urlSubjectId));
        } else if (res.data.length > 0 && !subjectId) {
          setSubjectId(res.data[0].id);
        }
      })
      .catch(() => message.error('加载主体列表失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载预览 + 待审核 + 无法识别
  const fetchAll = useCallback(async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const [previewRes, pendingRes, unidRes, accRes] = await Promise.all([
        previewBookings(subjectId),
        getPendingReview(subjectId),
        getUnidentified(subjectId),
        listAccounts(subjectId, { level: 1 }),
      ]);
      setBookings(previewRes.data.bookings);
      setPendingVouchers(pendingRes.data as Voucher[]);
      setUnidentified(unidRes.data);
      setAccounts(accRes.data.filter((a) => a.isLeaf));
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // 生成记账
  const handleGenerate = async () => {
    if (!subjectId) return;
    setGenerating(true);
    try {
      const { data } = await generateBookings(subjectId);
      message.success(`已生成 ${data.generated} 条草稿凭证`);
      fetchAll();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '生成失败' : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  // 批量过账
  const handleBatchPost = async () => {
    if (selectedVoucherIds.length === 0) {
      message.warning('请先选择要过账的凭证');
      return;
    }
    try {
      const { data } = await batchPost(selectedVoucherIds);
      message.success(`成功过账 ${data.successCount} 条，失败 ${data.failCount} 条`);
      setSelectedVoucherIds([]);
      fetchAll();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '过账失败' : '过账失败');
    }
  };

  // 单条过账
  const handlePostOne = async (id: number) => {
    try {
      await postVoucher(id);
      message.success('过账成功');
      fetchAll();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '过账失败' : '过账失败');
    }
  };

  // 人工指定科目
  const handleAssign = async () => {
    if (!subjectId || !currentTxn || !assignAccountId) return;
    try {
      await assignManualEntry(subjectId, currentTxn.id, assignAccountId);
      message.success('已生成凭证');
      setAssignModalOpen(false);
      setCurrentTxn(null);
      setAssignAccountId(undefined);
      fetchAll();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '操作失败' : '操作失败');
    }
  };

  // 预览凭证列
  const bookingColumns: ColumnsType<PreviewBooking> = [
    { title: '来源', dataIndex: 'sourceType', key: 'sourceType', width: 90,
      render: (v: string) => {
        const map: Record<string, string> = { INVOICE: '发票', BANK: '银行', PAYROLL: '工资' };
        return <Tag>{map[v] || v}</Tag>;
      }
    },
    { title: '描述', dataIndex: 'sourceDesc', key: 'sourceDesc', ellipsis: true },
    { title: '日期', dataIndex: 'voucherDate', key: 'voucherDate', width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD')
    },
    { title: '分录预览', key: 'entries',
      render: (_: unknown, record: PreviewBooking) => (
        <div style={{ fontSize: 12 }}>
          {record.entries.map((e, i) => (
            <div key={i}>
              <span style={{ color: '#888' }}>{e.accountCode}</span> {e.accountName}：
              {e.debit > 0 ? `借 ${e.debit.toFixed(2)}` : `贷 ${e.credit.toFixed(2)}`}
            </div>
          ))}
        </div>
      )
    },
  ];

  // 待审核凭证列
  const voucherColumns: ColumnsType<Voucher> = [
    { title: '凭证字号', dataIndex: 'voucherNo', key: 'voucherNo', width: 160 },
    { title: '日期', dataIndex: 'voucherDate', key: 'voucherDate', width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD')
    },
    { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => <Tag color={VOUCHER_STATUS_COLOR[v]}>{VOUCHER_STATUS_TEXT[v] || v}</Tag>
    },
    { title: '分录', key: 'entries',
      render: (_: unknown, record: Voucher) => (
        <div style={{ fontSize: 12 }}>
          {record.entries?.map((e, i) => (
            <div key={i}>
              <span style={{ color: '#888' }}>{e.account?.code}</span> {e.account?.name}：
              {e.debit > 0 ? `借 ${e.debit.toFixed(2)}` : `贷 ${e.credit.toFixed(2)}`}
            </div>
          ))}
        </div>
      )
    },
    { title: '操作', key: 'action', width: 100,
      render: (_: unknown, record: Voucher) => (
        <Button type="link" size="small" onClick={() => handlePostOne(record.id)}>过账</Button>
      )
    },
  ];

  // 无法识别流水列
  const unidentifiedColumns: ColumnsType<UnidentifiedBankTxn> = [
    { title: '日期', dataIndex: 'transDate', key: 'transDate', width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD')
    },
    { title: '方向', dataIndex: 'direction', key: 'direction', width: 70,
      render: (v: string) => <Tag color={v === 'IN' ? 'green' : 'red'}>{v === 'IN' ? '收入' : '支出'}</Tag>
    },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100,
      render: (v: number) => v.toFixed(2)
    },
    { title: '对手方', dataIndex: 'counterparty', key: 'counterparty', ellipsis: true },
    { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
    { title: '操作', key: 'action', width: 100,
      render: (_: unknown, record: UnidentifiedBankTxn) => (
        <Button type="link" size="small" onClick={() => {
          setCurrentTxn(record);
          setAssignAccountId(undefined);
          setAssignModalOpen(true);
        }}>指定科目</Button>
      )
    },
  ];

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          智能记账
        </Space>
      }
      extra={
        <Space>
          <Select
            style={{ width: 240 }}
            placeholder="选择纳税人主体"
            value={subjectId}
            onChange={(v) => setSubjectId(v)}
            options={subjects.map((s) => ({ value: s.id, label: `${s.name}（${s.taxNumber}）` }))}
          />
          <Popconfirm
            title="将根据已导入的发票/流水/工资自动生成草稿凭证，确认生成？"
            onConfirm={handleGenerate}
            disabled={!subjectId}
          >
            <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} disabled={!subjectId}>
              生成记账
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : !subjectId ? (
        <Empty description="请先选择纳税人主体" />
      ) : (
        <Tabs
          items={[
            {
              key: 'preview',
              label: `待生成预览（${bookings.length}）`,
              children: (
                <Table<PreviewBooking>
                  rowKey={(r) => `${r.sourceType}-${r.sourceId}`}
                  size="small"
                  columns={bookingColumns}
                  dataSource={bookings}
                  pagination={false}
                  locale={{ emptyText: <Empty description="暂无可自动记账的数据，请先导入发票/流水/工资" /> }}
                />
              ),
            },
            {
              key: 'pending',
              label: `待审核凭证（${pendingVouchers.length}）`,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      type="primary"
                      onClick={handleBatchPost}
                      disabled={selectedVoucherIds.length === 0}
                    >
                      批量过账（{selectedVoucherIds.length}）
                    </Button>
                  </Space>
                  <Table<Voucher>
                    rowKey="id"
                    size="small"
                    columns={voucherColumns}
                    dataSource={pendingVouchers}
                    pagination={false}
                    rowSelection={{
                      selectedRowKeys: selectedVoucherIds,
                      onChange: (keys) => setSelectedVoucherIds(keys.map(Number)),
                    }}
                    locale={{ emptyText: <Empty description="暂无待审核凭证，请先点击「生成记账」" /> }}
                  />
                </>
              ),
            },
            {
              key: 'unidentified',
              label: `待人工确认（${unidentified.length}）`,
              children: (
                <Table<UnidentifiedBankTxn>
                  rowKey="id"
                  size="small"
                  columns={unidentifiedColumns}
                  dataSource={unidentified}
                  pagination={false}
                  locale={{ emptyText: <Empty description="暂无无法识别的银行流水" /> }}
                />
              ),
            },
          ]}
        />
      )}

      {/* 人工指定科目 Modal */}
      <Modal
        title="人工指定科目"
        open={assignModalOpen}
        onOk={handleAssign}
        onCancel={() => setAssignModalOpen(false)}
        okText="生成凭证"
        cancelText="取消"
      >
        {currentTxn && (
          <div style={{ marginBottom: 16 }}>
            <Typography.Text>
              {currentTxn.direction === 'IN' ? '收入' : '支出'} {currentTxn.amount.toFixed(2)} 元
              {currentTxn.counterparty ? ` | 对手方：${currentTxn.counterparty}` : ''}
            </Typography.Text>
            <Input.TextArea
              style={{ marginTop: 8 }}
              value={currentTxn.summary || ''}
              readOnly
              rows={2}
              placeholder="摘要"
            />
          </div>
        )}
        <div>
          <Typography.Text>选择对方科目（银行存款自动匹配）：</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 8 }}
            placeholder="选择科目"
            value={assignAccountId}
            onChange={setAssignAccountId}
            showSearch
            optionFilterProp="label"
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.code} ${a.name}`,
            }))}
          />
        </div>
      </Modal>
    </Card>
  );
}
