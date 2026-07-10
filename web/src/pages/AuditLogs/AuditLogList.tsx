import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  Space,
  Modal,
  Typography,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import {
  listAuditLogs,
  verifyAuditChain,
  type AuditLogItem,
  type AuditVerifyResponse,
} from '../../api/audit';

const { RangePicker } = DatePicker;

// 常见操作类型下拉选项（支持自由输入）
const ACTION_OPTIONS = [
  { label: '注册用户', value: '注册用户' },
  { label: '登录', value: '登录' },
  { label: '创建主体', value: '创建主体' },
  { label: '更新主体', value: '更新主体' },
  { label: '删除主体', value: '删除主体' },
];

// 当前用户信息（从 localStorage 读取 role 判断是否 ADMIN）
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

export default function AuditLogList() {
  const [data, setData] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [form] = Form.useForm();
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResponse | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);

  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'ADMIN';

  // 拉取审计日志
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const params: {
        userId?: number;
        action?: string;
        from?: string;
        to?: string;
        page: number;
        pageSize: number;
      } = { page, pageSize };

      if (values.userId) {
        const n = parseInt(String(values.userId), 10);
        if (!Number.isNaN(n)) params.userId = n;
      }
      // Select mode="tags" 返回数组，取第一个元素作为筛选值
      if (values.action && Array.isArray(values.action) && values.action.length) {
        params.action = String(values.action[0]);
      } else if (typeof values.action === 'string' && values.action) {
        params.action = values.action;
      }
      if (values.range && Array.isArray(values.range) && values.range.length === 2) {
        const [start, end] = values.range as [Dayjs, Dayjs];
        params.from = start.startOf('day').toISOString();
        params.to = end.endOf('day').toISOString();
      }

      const { data: res } = await listAuditLogs(params);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || '查询审计日志失败');
    } finally {
      setLoading(false);
    }
  }, [form, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 校验审计链
  const handleVerify = async () => {
    setVerifyLoading(true);
    try {
      const { data: res } = await verifyAuditChain();
      setVerifyResult(res);
      setVerifyModalOpen(true);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || '校验审计链失败');
    } finally {
      setVerifyLoading(false);
    }
  };

  // 表格列定义
  const columns: ColumnsType<AuditLogItem> = [
    {
      title: '序号',
      dataIndex: 'seq',
      key: 'seq',
      width: 80,
      // AUDITOR 看不到 seq 字段，使用 row index 作为兜底显示
      render: (_value: unknown, _record: AuditLogItem, index: number) => {
        return (page - 1) * pageSize + index + 1;
      },
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '用户',
      dataIndex: 'userId',
      key: 'userId',
      width: 80,
      render: (v: number) => `#${v}`,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 140,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '对象',
      dataIndex: 'target',
      key: 'target',
      width: 140,
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 140,
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (v: string | null) =>
        v ? <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text> : '-',
    },
    // ADMIN 才能看到 hash 列
    ...(isAdmin
      ? [
          {
            title: 'Hash(前12位)',
            key: 'hash',
            width: 140,
            render: (_v: unknown, r: AuditLogItem) =>
              r.hash ? (
                <Typography.Text code style={{ fontSize: 12 }}>
                  {r.hash.slice(0, 12)}…
                </Typography.Text>
              ) : (
                '-'
              ),
          } as ColumnsType<AuditLogItem>[number],
        ]
      : []),
  ];

  return (
    <Card
      title="审计日志"
      extra={
        isAdmin ? (
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined />}
            loading={verifyLoading}
            onClick={handleVerify}
          >
            校验审计链
          </Button>
        ) : null
      }
    >
      <Form
        form={form}
        layout="inline"
        style={{ marginBottom: 16 }}
        onFinish={() => {
          setPage(1);
          fetchData();
        }}
        onReset={() => {
          form.resetFields();
          setPage(1);
          fetchData();
        }}
      >
        <Form.Item name="action" label="操作类型">
          <Select
            placeholder="选择或输入操作类型"
            allowClear
            showSearch
            mode="tags"
            maxCount={1}
            options={ACTION_OPTIONS}
            style={{ width: 200 }}
          />
        </Form.Item>
        <Form.Item name="userId" label="用户ID">
          <Input placeholder="如：1" allowClear style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="range" label="时间范围">
          <RangePicker showTime={false} style={{ width: 240 }} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
            <Button htmlType="reset">重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table<AuditLogItem>
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        size="small"
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Modal
        title="审计链校验结果"
        open={verifyModalOpen}
        onOk={() => setVerifyModalOpen(false)}
        onCancel={() => setVerifyModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setVerifyModalOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        {verifyResult ? (
          <div style={{ padding: '8px 0' }}>
            <p>
              校验状态：
              {verifyResult.valid ? (
                <Tag color="success">通过</Tag>
              ) : (
                <Tag color="error">已损坏</Tag>
              )}
            </p>
            <p>日志总数：{verifyResult.total}</p>
            {verifyResult.valid ? (
              <Typography.Paragraph type="success">
                所有日志的 hash 与 prevHash 链条一致，未检测到篡改。
              </Typography.Paragraph>
            ) : (
              <Typography.Paragraph type="danger">
                在序号 <strong>{verifyResult.brokenAt}</strong> 处发现链断裂或 hash 不匹配，
                日志可能被篡改，请立即核查。
              </Typography.Paragraph>
            )}
          </div>
        ) : (
          <Typography.Text>无结果</Typography.Text>
        )}
      </Modal>
    </Card>
  );
}
