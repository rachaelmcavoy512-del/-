import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Switch,
  Modal,
  Form,
  Input,
  Typography,
  message,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import {
  listIndicators,
  updateIndicator,
  type RiskIndicator,
} from '../../api/risk';

// 指标类别中文映射
const CATEGORY_TEXT: Record<string, string> = {
  VAT: '增值税',
  CIT: '所得税',
  INVOICE: '发票',
  FUND: '资金',
  RELATED: '关联交易',
  OTHER: '其他',
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

export default function RiskIndicatorList() {
  const [list, setList] = useState<RiskIndicator[]>([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<RiskIndicator | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'ADMIN';

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listIndicators();
      setList(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 切换启用状态
  const handleToggleEnabled = async (record: RiskIndicator, enabled: boolean) => {
    try {
      await updateIndicator(record.id, { enabled });
      message.success(enabled ? '已启用' : '已禁用');
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '操作失败' : '操作失败');
    }
  };

  // 打开编辑阈值弹窗
  const handleEdit = (record: RiskIndicator) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description ?? '',
      thresholdHigh: record.thresholdHigh,
      thresholdMedium: record.thresholdMedium,
      thresholdLow: record.thresholdLow ?? '',
    });
    setEditOpen(true);
  };

  // 保存阈值编辑
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await updateIndicator(editing!.id, {
        name: values.name,
        description: values.description ?? null,
        thresholdHigh: values.thresholdHigh,
        thresholdMedium: values.thresholdMedium,
        thresholdLow: values.thresholdLow ?? null,
      });
      message.success('指标配置已更新，可前往事件列表点"重新扫描"应用新阈值');
      setEditOpen(false);
      setEditing(null);
      fetchList();
    } catch (e) {
      if (axios.isAxiosError(e)) {
        message.error(e.response?.data?.error || '保存失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<RiskIndicator> = [
    { title: '编码', dataIndex: 'code', key: 'code', width: 220 },
    { title: '指标名称', dataIndex: 'name', key: 'name' },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (v: string) => <Tag>{CATEGORY_TEXT[v] || v}</Tag>,
    },
    {
      title: '高风险阈值',
      dataIndex: 'thresholdHigh',
      key: 'thresholdHigh',
      width: 200,
      ellipsis: true,
    },
    {
      title: '中风险阈值',
      dataIndex: 'thresholdMedium',
      key: 'thresholdMedium',
      width: 200,
      ellipsis: true,
    },
    {
      title: '低风险阈值',
      dataIndex: 'thresholdLow',
      key: 'thresholdLow',
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (v: boolean, record: RiskIndicator) =>
        isAdmin ? (
          <Switch checked={v} onChange={(checked) => handleToggleEnabled(record, checked)} />
        ) : (
          <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '禁用'}</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record: RiskIndicator) =>
        isAdmin ? (
          <Button type="link" size="small" onClick={() => handleEdit(record)}>
            编辑阈值
          </Button>
        ) : (
          '-'
        ),
    },
  ];

  // 非 ADMIN 仅可查看
  if (!isAdmin) {
    return (
      <Card title="风险指标库">
        <Alert type="info" showIcon message="仅管理员可编辑风险指标阈值，以下为当前指标库配置（只读）。" />
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          pagination={false}
          style={{ marginTop: 16 }}
        />
      </Card>
    );
  }

  return (
    <Card
      title="风险指标库管理"
      extra={
        <Space>
          <Button onClick={fetchList}>刷新</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="阈值格式说明"
        description={
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            阈值为 JSON 字符串，如：<Typography.Text code>{'{"lt":0.01}'}</Typography.Text> 表示小于该值触发、
            <Typography.Text code>{'{"gt":0.5}'}</Typography.Text> 表示大于、
            <Typography.Text code>{'{"roundTrip":true}'}</Typography.Text> 表示资金回流、
            <Typography.Text code>{'{"consecutiveZeroGte":3}'}</Typography.Text> 表示连续零申报≥3期。
            修改阈值后请在"风险事件"页点"重新扫描"以应用新阈值并更新历史事件。
          </Typography.Paragraph>
        }
      />
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={false}
      />

      <Modal
        title={`编辑指标阈值 - ${editing?.code ?? ''}`}
        open={editOpen}
        onOk={handleSave}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="指标名称"
            rules={[{ required: true, message: '请输入指标名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label="指标说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="thresholdHigh"
            label="高风险阈值（JSON）"
            rules={[{ required: true, message: '请输入高风险阈值' }]}
          >
            <Input placeholder='例如 {"lt":0.01}' />
          </Form.Item>
          <Form.Item
            name="thresholdMedium"
            label="中风险阈值（JSON）"
            rules={[{ required: true, message: '请输入中风险阈值' }]}
          >
            <Input placeholder='例如 {"lt":0.02}' />
          </Form.Item>
          <Form.Item name="thresholdLow" label="低风险阈值（JSON，可空）">
            <Input placeholder='例如 {"lt":0.03}' />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
