import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Typography,
  Tag,
  Popconfirm,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import axios from 'axios';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';
import {
  listVouchers,
  postVoucher,
  voidVoucher,
  redOffsetVoucher,
  type Voucher,
  type VoucherStatus,
} from '../../api/voucher';

const { RangePicker } = DatePicker;

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

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'POSTED', label: '已过账' },
  { value: 'VOID', label: '已作废' },
  { value: 'RED_VOID', label: '红冲' },
];

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

export default function VoucherList() {
  const navigate = useNavigate();
  const [data, setData] = useState<Voucher[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<VoucherStatus | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

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

  // 拉取凭证列表
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        subjectId?: number;
        from?: string;
        to?: string;
        status?: VoucherStatus;
        page: number;
        pageSize: number;
      } = { page, pageSize };
      if (subjectId) params.subjectId = subjectId;
      if (status) params.status = status;
      if (range && range.length === 2) {
        params.from = range[0].startOf('day').toISOString();
        params.to = range[1].endOf('day').toISOString();
      }
      const { data: res } = await listVouchers(params);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, subjectId, status, range]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 过账
  const handlePost = async (record: Voucher) => {
    try {
      await postVoucher(record.id);
      message.success('过账成功');
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '过账失败' : '过账失败');
    }
  };

  // 作废
  const handleVoid = async (record: Voucher) => {
    try {
      await voidVoucher(record.id);
      message.success('作废成功');
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '作废失败' : '作废失败');
    }
  };

  // 红冲
  const handleRedOffset = async (record: Voucher) => {
    try {
      await redOffsetVoucher(record.id, '列表页红冲');
      message.success('红冲成功，已生成红冲凭证并自动过账');
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '红冲失败' : '红冲失败');
    }
  };

  const columns: ColumnsType<Voucher> = [
    { title: '凭证字号', dataIndex: 'voucherNo', key: 'voucherNo', width: 160 },
    {
      title: '日期',
      dataIndex: 'voucherDate',
      key: 'voucherDate',
      width: 120,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (v?: number) => (v !== undefined && v !== null ? v.toFixed(2) : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: VoucherStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: unknown, record: Voucher) => (
        <Space>
          <Button type="link" size="small" onClick={() => navigate(`/vouchers/${record.id}`)}>
            查看
          </Button>
          {canManage && record.status === 'DRAFT' && (
            <>
              <Popconfirm title="确定过账该凭证吗？" onConfirm={() => handlePost(record)}>
                <Button type="link" size="small">
                  过账
                </Button>
              </Popconfirm>
              <Popconfirm title="确定作废该草稿凭证吗？" onConfirm={() => handleVoid(record)}>
                <Button type="link" size="small" danger>
                  作废
                </Button>
              </Popconfirm>
            </>
          )}
          {canManage && record.status === 'POSTED' && (
            <Popconfirm
              title="确定红冲该凭证吗？"
              description="将生成红冲凭证并自动过账，冲销原凭证"
              onConfirm={() => handleRedOffset(record)}
            >
              <Button type="link" size="small" danger>
                红冲
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="凭证记账"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchList}>
            刷新
          </Button>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/vouchers/new')}>
              新增凭证
            </Button>
          )}
          <Button onClick={() => navigate('/vouchers/period-close')}>期末结转</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="选择纳税人主体"
          style={{ width: 240 }}
          value={subjectId}
          onChange={(v) => {
            setSubjectId(v);
            setPage(1);
          }}
          options={taxpayers.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 140 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <RangePicker
          value={range}
          onChange={(v) => {
            setRange(v as [Dayjs, Dayjs] | null);
            setPage(1);
          }}
        />
        <Typography.Text type="secondary">共 {total} 条</Typography.Text>
      </Space>

      <Table<Voucher>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </Card>
  );
}
