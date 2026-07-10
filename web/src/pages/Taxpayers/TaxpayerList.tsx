import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Select,
  Typography,
  Tag,
  Popconfirm,
  message,
} from 'antd';
import axios from 'axios';
import { PlusOutlined, ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons';
import {
  TaxpayerSubject,
  listTaxpayers,
  deleteTaxpayer,
} from '../../api/taxpayer';
import TaxpayerForm from './TaxpayerForm';
import TaxpayerAccounts from './TaxpayerAccounts';

// 纳税人类型标签
const TYPE_LABEL: Record<string, string> = {
  SMALL_SCALE: '小规模纳税人',
  GENERAL: '一般纳税人',
};

const TYPE_COLOR: Record<string, string> = {
  SMALL_SCALE: 'blue',
  GENERAL: 'gold',
};

const TYPE_OPTIONS = [
  { value: 'SMALL_SCALE', label: '小规模纳税人' },
  { value: 'GENERAL', label: '一般纳税人' },
];

// 当前登录用户
interface CurrentUser {
  id: number;
  username: string;
  role: string;
}

export default function TaxpayerList() {
  const [list, setList] = useState<TaxpayerSubject[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string | undefined>(undefined);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaxpayerSubject | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [currentTaxpayer, setCurrentTaxpayer] = useState<TaxpayerSubject | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  // 获取当前用户信息以判断角色
  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (raw) {
      try {
        setUser(JSON.parse(raw) as CurrentUser);
      } catch {
        /* ignore */
      }
    }
  }, []);

  // 拉取列表
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listTaxpayers({ type, keyword });
      setList(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [type, keyword]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 新建
  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  // 编辑
  const handleEdit = (record: TaxpayerSubject) => {
    setEditing(record);
    setFormOpen(true);
  };

  // 查看科目
  const handleViewAccounts = (record: TaxpayerSubject) => {
    setCurrentTaxpayer(record);
    setAccountsOpen(true);
  };

  // 删除
  const handleDelete = async (record: TaxpayerSubject) => {
    try {
      await deleteTaxpayer(record.id);
      message.success('删除成功');
      fetchList();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '删除失败' : '删除失败');
    }
  };

  // 表单保存成功后刷新
  const handleFormSuccess = () => {
    setFormOpen(false);
    setEditing(null);
    fetchList();
  };

  const columns = [
    { title: '企业名称', dataIndex: 'name', key: 'name' },
    { title: '纳税人识别号', dataIndex: 'taxNumber', key: 'taxNumber', width: 200 },
    {
      title: '类型',
      dataIndex: 'taxpayerType',
      key: 'taxpayerType',
      width: 130,
      render: (v: string) => (
        <Tag color={TYPE_COLOR[v] || 'default'}>{TYPE_LABEL[v] || v}</Tag>
      ),
    },
    { title: '行业', dataIndex: 'industry', key: 'industry', width: 160 },
    {
      title: '适用税率',
      dataIndex: 'taxRate',
      key: 'taxRate',
      width: 100,
      render: (v: number | null) => (v !== null && v !== undefined ? `${(v * 100).toFixed(2)}%` : '-'),
    },
    { title: '法人', dataIndex: 'legalPerson', key: 'legalPerson', width: 100 },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: unknown, record: TaxpayerSubject) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<UnorderedListOutlined />}
            onClick={() => handleViewAccounts(record)}
          >
            科目
          </Button>
          {isAdmin && (
            <>
              <Button type="link" size="small" onClick={() => handleEdit(record)}>
                编辑
              </Button>
              <Popconfirm
                title="确定删除该纳税人主体吗？"
                description="将级联删除其下所有科目"
                onConfirm={() => handleDelete(record)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="纳税人主体管理"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchList}>
            刷新
          </Button>
          {isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              新建主体
            </Button>
          )}
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          placeholder="按名称或税号搜索"
          style={{ width: 260 }}
          onSearch={(v) => setKeyword(v)}
          enterButton
        />
        <Select
          allowClear
          placeholder="类型筛选"
          style={{ width: 160 }}
          value={type}
          onChange={(v) => setType(v)}
          options={TYPE_OPTIONS}
        />
        <Typography.Text type="secondary">共 {list.length} 条</Typography.Text>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns as never}
        dataSource={list}
        pagination={{ pageSize: 10, showSizeChanger: true }}
      />

      <TaxpayerForm
        open={formOpen}
        initialValues={editing}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSuccess={handleFormSuccess}
      />

      <TaxpayerAccounts
        open={accountsOpen}
        taxpayerId={currentTaxpayer?.id ?? null}
        taxpayerName={currentTaxpayer?.name}
        onClose={() => {
          setAccountsOpen(false);
          setCurrentTaxpayer(null);
        }}
      />
    </Card>
  );
}
