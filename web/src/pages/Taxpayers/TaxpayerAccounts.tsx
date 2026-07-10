import { useEffect, useState, useCallback } from 'react';
import {
  Drawer,
  Table,
  Button,
  Space,
  Select,
  Tag,
  Popconfirm,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  message,
  Typography,
} from 'antd';
import axios from 'axios';
import { PlusOutlined } from '@ant-design/icons';
import {
  Account,
  AccountInput,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '../../api/taxpayer';

// 类别标签映射
const CATEGORY_LABEL: Record<string, string> = {
  ASSET: '资产',
  LIABILITY: '负债',
  EQUITY: '所有者权益',
  COST: '成本',
  INCOME: '损益收入',
  EXPENSE: '损益支出',
};

const CATEGORY_COLOR: Record<string, string> = {
  ASSET: 'blue',
  LIABILITY: 'red',
  EQUITY: 'purple',
  COST: 'orange',
  INCOME: 'green',
  EXPENSE: 'volcano',
};

const DIRECTION_LABEL: Record<string, string> = {
  DEBIT: '借方',
  CREDIT: '贷方',
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

interface Props {
  open: boolean;
  taxpayerId: number | null;
  taxpayerName?: string;
  onClose: () => void;
}

// 判断当前用户是否有科目管理权限（ADMIN / ACCOUNTANT）
function canManageAccount(): boolean {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return false;
    const user = JSON.parse(raw) as { role?: string };
    return user.role === 'ADMIN' || user.role === 'ACCOUNTANT';
  } catch {
    return false;
  }
}

export default function TaxpayerAccounts({ open, taxpayerId, taxpayerName, onClose }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [level, setLevel] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form] = Form.useForm<AccountInput>();
  const [submitting, setSubmitting] = useState(false);
  const manageable = canManageAccount();

  // 拉取科目列表
  const fetchAccounts = useCallback(async () => {
    if (!taxpayerId) return;
    setLoading(true);
    try {
      const { data } = await listAccounts(taxpayerId, {
        category,
        level,
      });
      setAccounts(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [taxpayerId, category, level]);

  useEffect(() => {
    if (open && taxpayerId) {
      fetchAccounts();
    }
  }, [open, taxpayerId, fetchAccounts]);

  // 打开新增弹窗
  const handleAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      direction: 'DEBIT',
      balanceDirection: 'DEBIT',
      level: 1,
      isLeaf: true,
    });
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const handleEdit = (record: Account) => {
    setEditing(record);
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      direction: record.direction,
      level: record.level,
      parentCode: record.parentCode ?? undefined,
      category: record.category,
      balanceDirection: record.balanceDirection,
      isLeaf: record.isLeaf,
    });
    setModalOpen(true);
  };

  // 提交新增/编辑
  const handleSubmit = async () => {
    if (!taxpayerId) return;
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editing) {
        await updateAccount(taxpayerId, editing.id, values);
        message.success('修改成功');
      } else {
        await createAccount(taxpayerId, values);
        message.success('新增成功');
      }
      setModalOpen(false);
      fetchAccounts();
    } catch (e) {
      if (axios.isAxiosError(e)) {
        message.error(e.response?.data?.error || '操作失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 删除科目
  const handleDelete = async (record: Account) => {
    if (!taxpayerId) return;
    try {
      await deleteAccount(taxpayerId, record.id);
      message.success('删除成功');
      fetchAccounts();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '删除失败' : '删除失败');
    }
  };

  const columns = [
    { title: '编码', dataIndex: 'code', key: 'code', width: 120 },
    { title: '科目名称', dataIndex: 'name', key: 'name' },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (v: string) => (
        <Tag color={CATEGORY_COLOR[v] || 'default'}>{CATEGORY_LABEL[v] || v}</Tag>
      ),
    },
    {
      title: '方向',
      dataIndex: 'direction',
      key: 'direction',
      width: 80,
      render: (v: string) => DIRECTION_LABEL[v] || v,
    },
    { title: '级次', dataIndex: 'level', key: 'level', width: 70 },
    { title: '父科目', dataIndex: 'parentCode', key: 'parentCode', width: 100 },
    {
      title: '余额方向',
      dataIndex: 'balanceDirection',
      key: 'balanceDirection',
      width: 90,
      render: (v: string) => DIRECTION_LABEL[v] || v,
    },
    {
      title: '末级',
      dataIndex: 'isLeaf',
      key: 'isLeaf',
      width: 70,
      render: (v: boolean) => (v ? '是' : '否'),
    },
    ...(manageable
      ? [
          {
            title: '操作',
            key: 'action',
            width: 140,
            render: (_: unknown, record: Account) => (
              <Space>
                <Button type="link" size="small" onClick={() => handleEdit(record)}>
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除该科目吗？"
                  description="后续将校验余额与凭证引用"
                  onConfirm={() => handleDelete(record)}
                >
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <Drawer
      title={`科目管理 - ${taxpayerName ?? ''}`}
      open={open}
      onClose={onClose}
      width={960}
      destroyOnClose
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="按类别筛选"
          style={{ width: 160 }}
          value={category}
          onChange={(v) => setCategory(v)}
          options={CATEGORY_OPTIONS}
        />
        <Select
          allowClear
          placeholder="按级次筛选"
          style={{ width: 120 }}
          value={level}
          onChange={(v) => setLevel(v)}
          options={[
            { value: '1', label: '1 级' },
            { value: '2', label: '2 级' },
            { value: '3', label: '3 级' },
            { value: '4', label: '4 级' },
          ]}
        />
        {manageable && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增科目
          </Button>
        )}
        <Typography.Text type="secondary">共 {accounts.length} 个科目</Typography.Text>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns as never}
        dataSource={accounts}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        scroll={{ y: 520 }}
      />

      <Modal
        title={editing ? '编辑科目' : '新增科目'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="科目编码"
            rules={[{ required: true, message: '请输入科目编码' }]}
          >
            <Input placeholder="如 1001 或 22210101" maxLength={20} />
          </Form.Item>
          <Form.Item
            name="name"
            label="科目名称"
            rules={[{ required: true, message: '请输入科目名称' }]}
          >
            <Input placeholder="如 库存现金" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="category"
            label="类别"
            rules={[{ required: true, message: '请选择类别' }]}
          >
            <Select options={CATEGORY_OPTIONS} placeholder="请选择类别" />
          </Form.Item>
          <Form.Item
            name="direction"
            label="发生方向"
            rules={[{ required: true, message: '请选择方向' }]}
          >
            <Select
              options={[
                { value: 'DEBIT', label: '借方' },
                { value: 'CREDIT', label: '贷方' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="balanceDirection"
            label="余额方向"
            rules={[{ required: true, message: '请选择余额方向' }]}
          >
            <Select
              options={[
                { value: 'DEBIT', label: '借方' },
                { value: 'CREDIT', label: '贷方' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="level"
            label="级次"
            rules={[{ required: true, message: '请输入级次' }]}
          >
            <InputNumber min={1} max={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="parentCode" label="父科目编码">
            <Input placeholder="如 2221（一级科目可留空）" maxLength={20} />
          </Form.Item>
          <Form.Item name="isLeaf" label="是否末级科目" valuePropName="checked">
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
