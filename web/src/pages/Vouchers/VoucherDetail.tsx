import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Descriptions,
  Table,
  Button,
  Space,
  Tag,
  Popconfirm,
  Spin,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getVoucher,
  postVoucher,
  voidVoucher,
  redOffsetVoucher,
  deleteVoucher,
  type Voucher,
  type VoucherEntry,
  type VoucherStatus,
} from '../../api/voucher';

// 凭证状态标签
const STATUS_LABEL: Record<VoucherStatus, string> = {
  DRAFT: '草稿',
  POSTED: '已过账',
  VOID: '已作废',
  RED_VOID: '红冲',
};

const STATUS_COLOR: Record<VoucherStatus, string> = {
  DRAFT: 'default',
  POSTED: 'green',
  VOID: 'red',
  RED_VOID: 'volcano',
};

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

export default function VoucherDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const voucherId = Number(id);
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const currentUser = getCurrentUser();
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT';

  const fetchVoucher = useCallback(async () => {
    if (Number.isNaN(voucherId)) return;
    setLoading(true);
    try {
      const { data } = await getVoucher(voucherId);
      setVoucher(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [voucherId]);

  useEffect(() => {
    fetchVoucher();
  }, [fetchVoucher]);

  // 过账
  const handlePost = async () => {
    setActionLoading(true);
    try {
      await postVoucher(voucherId);
      message.success('过账成功');
      fetchVoucher();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '过账失败' : '过账失败');
    } finally {
      setActionLoading(false);
    }
  };

  // 作废
  const handleVoid = async () => {
    setActionLoading(true);
    try {
      await voidVoucher(voucherId);
      message.success('作废成功');
      fetchVoucher();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '作废失败' : '作废失败');
    } finally {
      setActionLoading(false);
    }
  };

  // 红冲
  const handleRedOffset = async () => {
    setActionLoading(true);
    try {
      await redOffsetVoucher(voucherId, '详情页红冲');
      message.success('红冲成功，已生成红冲凭证并自动过账');
      fetchVoucher();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '红冲失败' : '红冲失败');
    } finally {
      setActionLoading(false);
    }
  };

  // 删除
  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await deleteVoucher(voucherId);
      message.success('删除成功');
      navigate('/vouchers');
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '删除失败' : '删除失败');
    } finally {
      setActionLoading(false);
    }
  };

  const columns: ColumnsType<VoucherEntry> = [
    {
      title: '科目',
      key: 'account',
      render: (_: unknown, row: VoucherEntry) =>
        row.account ? `${row.account.code} ${row.account.name}` : `#${row.accountId}`,
    },
    { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
    {
      title: '借方',
      dataIndex: 'debit',
      key: 'debit',
      width: 140,
      align: 'right',
      render: (v: number) => (v ? v.toFixed(2) : ''),
    },
    {
      title: '贷方',
      dataIndex: 'credit',
      key: 'credit',
      width: 140,
      align: 'right',
      render: (v: number) => (v ? v.toFixed(2) : ''),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!voucher) {
    return (
      <Card>
        <Typography.Text type="secondary">凭证不存在</Typography.Text>
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => navigate('/vouchers')}>返回列表</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={`凭证 ${voucher.voucherNo}`}
      extra={
        <Space>
          <Button onClick={() => navigate('/vouchers')}>返回列表</Button>
          {canManage && voucher.status === 'DRAFT' && (
            <Button onClick={() => navigate(`/vouchers/new?edit=${voucher.id}`)}>编辑</Button>
          )}
          {canManage && voucher.status === 'DRAFT' && (
            <>
              <Popconfirm title="确定过账该凭证吗？" onConfirm={handlePost}>
                <Button type="primary" loading={actionLoading}>
                  过账
                </Button>
              </Popconfirm>
              <Popconfirm title="确定作废该草稿凭证吗？" onConfirm={handleVoid}>
                <Button danger loading={actionLoading}>
                  作废
                </Button>
              </Popconfirm>
              <Popconfirm title="确定删除该草稿凭证吗？" onConfirm={handleDelete}>
                <Button danger loading={actionLoading}>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
          {canManage && voucher.status === 'POSTED' && (
            <Popconfirm
              title="确定红冲该凭证吗？"
              description="将生成红冲凭证并自动过账，冲销原凭证"
              onConfirm={handleRedOffset}
            >
              <Button danger loading={actionLoading}>
                红冲
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="凭证字号">{voucher.voucherNo}</Descriptions.Item>
        <Descriptions.Item label="记账日期">
          {dayjs(voucher.voucherDate).format('YYYY-MM-DD')}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={STATUS_COLOR[voucher.status]}>{STATUS_LABEL[voucher.status]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="摘要" span={2}>
          {voucher.summary || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="附件张数">{voucher.attachments}</Descriptions.Item>
        <Descriptions.Item label="创建人">#{voucher.createdBy}</Descriptions.Item>
        <Descriptions.Item label="过账人">
          {voucher.postedBy ? `#${voucher.postedBy}` : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="过账时间">
          {voucher.postedAt ? dayjs(voucher.postedAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
        </Descriptions.Item>
        {voucher.redOffsetVoucherId && (
          <Descriptions.Item label="红冲原凭证" span={3}>
            <Button
              type="link"
              size="small"
              onClick={() => navigate(`/vouchers/${voucher.redOffsetVoucherId}`)}
            >
              查看原凭证 #{voucher.redOffsetVoucherId}
            </Button>
          </Descriptions.Item>
        )}
      </Descriptions>

      <Table<VoucherEntry>
        rowKey="id"
        columns={columns}
        dataSource={voucher.entries}
        pagination={false}
        size="small"
        summary={(rows) => {
          const debit = rows.reduce((s, r) => s + (r.debit || 0), 0);
          const credit = rows.reduce((s, r) => s + (r.credit || 0), 0);
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              <Table.Summary.Cell index={2} align="right">
                <Typography.Text strong>{debit.toFixed(2)}</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <Typography.Text strong>{credit.toFixed(2)}</Typography.Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
    </Card>
  );
}
