import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Descriptions,
  Table,
  Button,
  Space,
  Tag,
  Spin,
  Typography,
  message,
  Popconfirm,
  Form,
  Select,
  DatePicker,
  Input,
  Empty,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getRiskEvent,
  updateRiskEventStatus,
  createRemediation,
  updateRemediation,
  listRiskUsers,
  type RiskEvent,
  type RiskRemediation,
  type RemediationStatus,
  type RiskAssignee,
} from '../../api/risk';

// 等级标签颜色
const LEVEL_COLOR: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' };
const LEVEL_TEXT: Record<string, string> = { HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' };
// 事件状态
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
// 整改任务状态
const REMEDIATION_STATUS_TEXT: Record<string, string> = {
  TODO: '待处理',
  DOING: '进行中',
  DONE: '已完成',
};
const REMEDIATION_STATUS_COLOR: Record<string, string> = {
  TODO: 'default',
  DOING: 'processing',
  DONE: 'success',
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

export default function RiskEventDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const [event, setEvent] = useState<RiskEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [users, setUsers] = useState<RiskAssignee[]>([]);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const currentUser = getCurrentUser();
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT';
  const canUpdateStatus =
    currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT' || currentUser?.role === 'AUDITOR';

  // 拉取事件详情
  const fetchEvent = useCallback(async () => {
    if (Number.isNaN(eventId)) return;
    setLoading(true);
    try {
      const { data } = await getRiskEvent(eventId);
      setEvent(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  // 拉取可指派用户列表
  useEffect(() => {
    if (!canManage) return;
    listRiskUsers()
      .then((res) => setUsers(res.data))
      .catch(() => undefined);
  }, [canManage]);

  // 更新事件状态（标记已整改/忽略/整改中）
  const handleUpdateStatus = async (
    status: 'RESOLVED' | 'IGNORED' | 'IN_PROGRESS',
    resolution: string
  ) => {
    setActionLoading(true);
    try {
      await updateRiskEventStatus(eventId, { status, resolution });
      message.success('状态已更新');
      fetchEvent();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '操作失败' : '操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  // 创建整改任务
  const handleCreateRemediation = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await createRemediation(eventId, {
        assigneeId: values.assigneeId,
        dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : null,
        note: values.note ?? null,
      });
      message.success('整改任务已创建');
      form.resetFields();
      fetchEvent();
    } catch (e) {
      if (axios.isAxiosError(e)) {
        message.error(e.response?.data?.error || '创建失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 更新整改任务状态
  const handleUpdateRemediation = async (
    remediation: RiskRemediation,
    status: RemediationStatus
  ) => {
    try {
      await updateRemediation(remediation.id, { status, note: remediation.note ?? null });
      message.success('整改任务状态已更新');
      fetchEvent();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '操作失败' : '操作失败');
    }
  };

  const remediationColumns: ColumnsType<RiskRemediation> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: '指派人',
      dataIndex: 'assigneeId',
      key: 'assigneeId',
      width: 140,
      render: (v: number) => {
        const u = users.find((x) => x.id === v);
        return u ? `${u.username}（${u.role}）` : `#${v}`;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: RemediationStatus) => (
        <Tag color={REMEDIATION_STATUS_COLOR[v]}>{REMEDIATION_STATUS_TEXT[v]}</Tag>
      ),
    },
    {
      title: '截止日期',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 120,
      render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: unknown, record: RiskRemediation) =>
        canManage ? (
          <Space>
            {record.status !== 'DOING' && (
              <Button
                type="link"
                size="small"
                onClick={() => handleUpdateRemediation(record, 'DOING')}
              >
                开始
              </Button>
            )}
            {record.status !== 'DONE' && (
              <Popconfirm
                title="确定标记该整改任务为已完成吗？"
                onConfirm={() => handleUpdateRemediation(record, 'DONE')}
              >
                <Button type="link" size="small">
                  完成
                </Button>
              </Popconfirm>
            )}
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!event) {
    return (
      <Card>
        <Typography.Text type="secondary">风险事件不存在</Typography.Text>
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => navigate('/risks/events')}>返回列表</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={`风险事件 #${event.id}`}
      extra={
        <Space>
          <Button onClick={() => navigate('/risks/events')}>返回列表</Button>
          {canUpdateStatus && event.status === 'PENDING' && (
            <Popconfirm
              title="确定忽略该风险事件吗？"
              onConfirm={() => handleUpdateStatus('IGNORED', '人工忽略')}
            >
              <Button loading={actionLoading} danger>
                忽略
              </Button>
            </Popconfirm>
          )}
          {canManage && event.status !== 'RESOLVED' && event.status !== 'IGNORED' && (
            <Popconfirm
              title="确定标记该风险事件为已整改吗？"
              onConfirm={() => handleUpdateStatus('RESOLVED', '人工标记已整改')}
            >
              <Button type="primary" loading={actionLoading}>
                标记已整改
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      {/* 高风险提示 */}
      {event.level === 'HIGH' && event.status !== 'RESOLVED' && event.status !== 'IGNORED' && (
        <Alert
          type="error"
          showIcon
          message="高风险预警"
          description="该事件为高风险，已推送管理员。请尽快创建整改任务并跟踪闭环。"
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 事件基础信息 */}
      <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="风险指标">{event.indicator.name}</Descriptions.Item>
        <Descriptions.Item label="指标编码">{event.indicator.code}</Descriptions.Item>
        <Descriptions.Item label="指标类别">{event.indicator.category}</Descriptions.Item>
        <Descriptions.Item label="纳税人主体">{event.subject.name}</Descriptions.Item>
        <Descriptions.Item label="纳税人识别号">{event.subject.taxNumber}</Descriptions.Item>
        <Descriptions.Item label="所属期">{event.period || '-'}</Descriptions.Item>
        <Descriptions.Item label="风险等级">
          <Tag color={LEVEL_COLOR[event.level]}>{LEVEL_TEXT[event.level]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="事件状态">
          <Tag color={STATUS_COLOR[event.status]}>{STATUS_TEXT[event.status]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="发现时间">
          {dayjs(event.detectedAt).format('YYYY-MM-DD HH:mm')}
        </Descriptions.Item>
        <Descriptions.Item label="命中值" span={3}>
          <Typography.Text strong>{event.metricValue}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="命中阈值" span={3}>
          {event.thresholdValue || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="风险描述" span={3}>
          {event.description}
        </Descriptions.Item>
        <Descriptions.Item label="整改建议" span={3}>
          {event.suggestion || '-'}
        </Descriptions.Item>
        {event.resolution && (
          <Descriptions.Item label="结案说明" span={3}>
            {event.resolution}
          </Descriptions.Item>
        )}
        {event.resolvedAt && (
          <Descriptions.Item label="结案时间" span={3}>
            {dayjs(event.resolvedAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
        )}
        {event.indicator.description && (
          <Descriptions.Item label="指标说明" span={3}>
            {event.indicator.description}
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* 整改任务列表 */}
      <Card
        type="inner"
        title="整改任务"
        extra={
          <Typography.Text type="secondary">
            共 {event.remediations?.length ?? 0} 条，全部完成后事件自动结案
          </Typography.Text>
        }
      >
        <Table<RiskRemediation>
          rowKey="id"
          size="small"
          columns={remediationColumns}
          dataSource={event.remediations ?? []}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无整改任务" /> }}
        />
      </Card>

      {/* 新增整改任务表单（仅 ADMIN/ACCOUNTANT 且事件未结案） */}
      {canManage && event.status !== 'RESOLVED' && event.status !== 'IGNORED' && (
        <Card type="inner" title="新增整改任务" style={{ marginTop: 16 }}>
          <Form form={form} layout="inline" onFinish={handleCreateRemediation}>
            <Form.Item
              name="assigneeId"
              label="指派人"
              rules={[{ required: true, message: '请选择指派人' }]}
            >
              <Select
                style={{ width: 200 }}
                placeholder="选择指派人"
                options={users.map((u) => ({
                  value: u.id,
                  label: `${u.username}（${u.role}）`,
                }))}
              />
            </Form.Item>
            <Form.Item name="dueDate" label="截止日期">
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input style={{ width: 260 }} placeholder="整改要求/说明" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting}>
                创建整改任务
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}
    </Card>
  );
}
