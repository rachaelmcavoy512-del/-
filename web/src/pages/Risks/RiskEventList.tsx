import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  Tag,
  Typography,
  message,
  Popconfirm,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  listRiskEvents,
  listIndicators,
  updateRiskEventStatus,
  rescanRisk,
  type RiskEvent,
  type RiskLevel,
  type RiskEventStatus,
  type RiskIndicator,
  type RiskEventQuery,
} from '../../api/risk';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';

// 等级标签颜色：红/橙/蓝
const LEVEL_COLOR: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' };
const LEVEL_TEXT: Record<string, string> = { HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' };
// 状态标签
const STATUS_TEXT: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '整改中',
  RESOLVED: '已整改',
  IGNORED: '已忽略',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'gold',
  IN_PROGRESS: 'processing',
  RESOLVED: 'green',
  IGNORED: 'default',
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

const LEVEL_OPTIONS = [
  { value: 'HIGH', label: '高风险' },
  { value: 'MEDIUM', label: '中风险' },
  { value: 'LOW', label: '低风险' },
];

const STATUS_OPTIONS = [
  { value: 'PENDING', label: '待处理' },
  { value: 'IN_PROGRESS', label: '整改中' },
  { value: 'RESOLVED', label: '已整改' },
  { value: 'IGNORED', label: '已忽略' },
];

export default function RiskEventList() {
  const navigate = useNavigate();
  const [list, setList] = useState<RiskEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [subjects, setSubjects] = useState<TaxpayerSubject[]>([]);
  const [indicators, setIndicators] = useState<RiskIndicator[]>([]);

  // 筛选条件
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [level, setLevel] = useState<RiskLevel | undefined>(undefined);
  const [status, setStatus] = useState<RiskEventStatus | undefined>(undefined);
  const [indicatorId, setIndicatorId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const currentUser = getCurrentUser();
  // 仅 ADMIN/ACCOUNTANT/AUDITOR 可变更事件状态
  const canManage =
    currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT' || currentUser?.role === 'AUDITOR';
  const isAdmin = currentUser?.role === 'ADMIN';

  // 拉取主体与指标列表用于筛选
  useEffect(() => {
    listTaxpayers()
      .then((res) => setSubjects(res.data))
      .catch(() => undefined);
    listIndicators()
      .then((res) => setIndicators(res.data))
      .catch(() => undefined);
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const query: RiskEventQuery = { page, pageSize };
      if (subjectId) query.subjectId = subjectId;
      if (level) query.level = level;
      if (status) query.status = status;
      if (indicatorId) query.indicatorId = indicatorId;
      const { data } = await listRiskEvents(query);
      setList(data.items);
      setTotal(data.total);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [subjectId, level, status, indicatorId, page, pageSize]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 忽略事件
  const handleIgnore = async (record: RiskEvent) => {
    try {
      await updateRiskEventStatus(record.id, { status: 'IGNORED', resolution: '人工忽略' });
      message.success('已忽略');
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '操作失败' : '操作失败');
    }
  };

  // 重新扫描（仅 ADMIN）
  const handleRescan = async () => {
    setRescanning(true);
    try {
      const { data } = await rescanRisk(subjectId);
      const totalScanned = data.results.reduce((s, r) => s + r.scanned, 0);
      const totalHit = data.results.reduce((s, r) => s + r.hit, 0);
      const totalClosed = data.results.reduce((s, r) => s + r.closed, 0);
      message.success(`重扫完成：扫描 ${totalScanned} 项，命中 ${totalHit}，关闭 ${totalClosed}`);
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '重扫失败' : '重扫失败');
    } finally {
      setRescanning(false);
    }
  };

  const columns: ColumnsType<RiskEvent> = [
    {
      title: '指标',
      key: 'indicator',
      render: (_: unknown, record: RiskEvent) => (
        <a onClick={() => navigate(`/risks/events/${record.id}`)}>{record.indicator.name}</a>
      ),
    },
    { title: '主体', dataIndex: ['subject', 'name'], key: 'subject', width: 160, ellipsis: true },
    {
      title: '等级',
      dataIndex: 'level',
      key: 'level',
      width: 90,
      render: (v: RiskLevel) => <Tag color={LEVEL_COLOR[v]}>{LEVEL_TEXT[v]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: RiskEventStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_TEXT[v]}</Tag>,
    },
    {
      title: '命中值',
      dataIndex: 'metricValue',
      key: 'metricValue',
      width: 220,
      ellipsis: true,
    },
    { title: '所属期', dataIndex: 'period', key: 'period', width: 100 },
    {
      title: '发现时间',
      dataIndex: 'detectedAt',
      key: 'detectedAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: unknown, record: RiskEvent) => (
        <Space>
          <Button type="link" size="small" onClick={() => navigate(`/risks/events/${record.id}`)}>
            查看
          </Button>
          {canManage && record.status !== 'RESOLVED' && record.status !== 'IGNORED' && (
            <Button type="link" size="small" onClick={() => navigate(`/risks/events/${record.id}`)}>
              整改
            </Button>
          )}
          {canManage && record.status === 'PENDING' && (
            <Popconfirm title="确定忽略该风险事件吗？" onConfirm={() => handleIgnore(record)}>
              <Button type="link" size="small" danger>
                忽略
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="风险事件列表"
      extra={
        <Space>
          {isAdmin && (
            <Popconfirm
              title="确定重新扫描吗？"
              description="将按当前阈值重新扫描历史数据，未命中的活跃事件会被自动关闭"
              onConfirm={handleRescan}
            >
              <Button loading={rescanning}>重新扫描</Button>
            </Popconfirm>
          )}
          <Button onClick={fetchList}>刷新</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="纳税人主体"
          style={{ width: 200 }}
          value={subjectId}
          onChange={(v) => {
            setSubjectId(v);
            setPage(1);
          }}
          options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          allowClear
          placeholder="风险等级"
          style={{ width: 130 }}
          value={level}
          onChange={(v) => {
            setLevel(v);
            setPage(1);
          }}
          options={LEVEL_OPTIONS}
        />
        <Select
          allowClear
          placeholder="事件状态"
          style={{ width: 130 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <Select
          allowClear
          placeholder="风险指标"
          style={{ width: 220 }}
          value={indicatorId}
          onChange={(v) => {
            setIndicatorId(v);
            setPage(1);
          }}
          options={indicators.map((i) => ({ value: i.id, label: i.name }))}
        />
        <Typography.Text type="secondary">共 {total} 条</Typography.Text>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
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
