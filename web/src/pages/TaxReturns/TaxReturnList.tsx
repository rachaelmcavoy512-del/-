// 税务申报列表（Task6）
// 筛选主体/税种/状态/所属期；显示税种/所属期/状态/应纳税额/操作（查看/生成）
// "生成申报"按钮打开 Modal 选税种+所属期
import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  Input,
  Typography,
  Tag,
  Modal,
  Form,
  Switch,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';
import {
  listTaxReturns,
  generateTaxReturn,
  type TaxReturn,
  type TaxType,
  type TaxReturnStatus,
  TAX_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_COLOR,
} from '../../api/taxReturn';

const { Text } = Typography;

// 税种选项
const TAX_TYPE_OPTIONS = [
  { value: 'VAT', label: '增值税' },
  { value: 'CIT', label: '企业所得税' },
  { value: 'SURTAX', label: '附加税' },
  { value: 'IIT', label: '个人所得税' },
  { value: 'STAMP', label: '印花税' },
];

// 状态选项
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'PENDING', label: '待申报' },
  { value: 'FILED', label: '已申报' },
  { value: 'PAID', label: '已缴款' },
];

// 城建税率选项
const URBAN_RATE_OPTIONS = [
  { value: 0.07, label: '7%（市区）' },
  { value: 0.05, label: '5%（县城）' },
  { value: 0.01, label: '1%（其他）' },
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

// 生成申报表单值
interface GenerateFormValues {
  subjectId: number;
  taxType: TaxType;
  period: string;
  isAnnual?: boolean;
  urbanRate?: number;
}

export default function TaxReturnList() {
  const navigate = useNavigate();
  const [data, setData] = useState<TaxReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [taxType, setTaxType] = useState<TaxType | undefined>(undefined);
  const [status, setStatus] = useState<TaxReturnStatus | undefined>(undefined);
  const [period, setPeriod] = useState<string>('');

  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [form] = Form.useForm<GenerateFormValues>();
  // 监听税种变化以控制附加字段显示
  const watchTaxType = Form.useWatch('taxType', form);
  const watchSubjectId = Form.useWatch('subjectId', form);

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

  // 拉取列表
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        subjectId?: number;
        taxType?: TaxType;
        status?: TaxReturnStatus;
        period?: string;
        page: number;
        pageSize: number;
      } = { page, pageSize };
      if (subjectId) params.subjectId = subjectId;
      if (taxType) params.taxType = taxType;
      if (status) params.status = status;
      if (period.trim()) params.period = period.trim();
      const { data: res } = await listTaxReturns(params);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, subjectId, taxType, status, period]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 打开生成 Modal，默认填充当前筛选的主体
  const openGenerate = () => {
    form.resetFields();
    if (subjectId) {
      form.setFieldsValue({ subjectId, taxType: 'VAT', urbanRate: 0.07, isAnnual: false });
    } else {
      form.setFieldsValue({ taxType: 'VAT', urbanRate: 0.07, isAnnual: false });
    }
    setGenOpen(true);
  };

  // 提交生成
  const handleGenerate = async () => {
    try {
      const values = await form.validateFields();
      setGenLoading(true);
      const { data: created } = await generateTaxReturn({
        subjectId: values.subjectId,
        taxType: values.taxType,
        period: values.period.trim(),
        isAnnual: values.isAnnual,
        urbanRate: values.urbanRate,
      });
      message.success('申报表生成成功');
      setGenOpen(false);
      // 跳转详情
      navigate(`/tax-returns/${created.id}`);
    } catch (e) {
      if (axios.isAxiosError(e)) {
        message.error(e.response?.data?.error || '生成失败');
      } else if (e instanceof Error) {
        // form 校验错误，不提示
      }
    } finally {
      setGenLoading(false);
    }
  };

  const columns: ColumnsType<TaxReturn> = [
    {
      title: '纳税人主体',
      key: 'subject',
      render: (_: unknown, r: TaxReturn) => r.subject?.name ?? `#${r.subjectId}`,
    },
    {
      title: '税种',
      dataIndex: 'taxType',
      key: 'taxType',
      width: 110,
      render: (v: TaxType) => TAX_TYPE_LABEL[v] ?? v,
    },
    { title: '税款所属期', dataIndex: 'period', key: 'period', width: 140 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: TaxReturnStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>,
    },
    {
      title: '应纳税额',
      dataIndex: 'taxAmount',
      key: 'taxAmount',
      width: 130,
      align: 'right',
      render: (v?: number) => (v !== undefined && v !== null ? (
        <Text strong style={{ color: '#cf1322' }}>
          {Number(v).toFixed(2)}
        </Text>
      ) : '-'),
    },
    {
      title: '生成时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: TaxReturn) => (
        <Button type="link" size="small" onClick={() => navigate(`/tax-returns/${record.id}`)}>
          查看
        </Button>
      ),
    },
  ];

  // 根据 taxType 给出所属期占位提示
  const periodPlaceholder =
    watchTaxType === 'CIT'
      ? '季度 YYYY-Q1 或年度 YYYY-FY'
      : '月度 YYYY-MM，如 2026-06';

  // 选中的主体类型（用于提示征收率）
  const selectedSubject = taxpayers.find((t) => t.id === watchSubjectId);

  return (
    <Card
      title="税务申报"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchList}>
            刷新
          </Button>
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openGenerate}>
              生成申报
            </Button>
          )}
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
          placeholder="税种筛选"
          style={{ width: 140 }}
          value={taxType}
          onChange={(v) => {
            setTaxType(v);
            setPage(1);
          }}
          options={TAX_TYPE_OPTIONS}
        />
        <Select
          allowClear
          placeholder="状态筛选"
          style={{ width: 130 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <Input
          allowClear
          placeholder="所属期，如 2026-06"
          style={{ width: 180 }}
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setPage(1);
          }}
        />
        <Text type="secondary">共 {total} 条</Text>
      </Space>

      <Table<TaxReturn>
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

      <Modal
        title="生成申报表"
        open={genOpen}
        onCancel={() => setGenOpen(false)}
        confirmLoading={genLoading}
        onOk={handleGenerate}
        okText="生成"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="subjectId"
            label="纳税人主体"
            rules={[{ required: true, message: '请选择纳税人主体' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择纳税人主体"
              options={taxpayers.map((t) => ({
                value: t.id,
                label: `${t.name}（${t.taxpayerType === 'GENERAL' ? '一般纳税人' : '小规模'}）`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="taxType"
            label="税种"
            rules={[{ required: true, message: '请选择税种' }]}
          >
            <Select options={TAX_TYPE_OPTIONS} />
          </Form.Item>

          <Form.Item
            name="period"
            label="税款所属期"
            rules={[
              { required: true, message: '请输入所属期' },
              {
                pattern: /^\d{4}(-\d{1,2}|-Q[1-4]|-FY)?$/,
                message: '格式：YYYY-MM / YYYY-Q1..Q4 / YYYY-FY',
              },
            ]}
            extra={
              selectedSubject && watchTaxType === 'VAT'
                ? `当前主体：${
                    selectedSubject.taxpayerType === 'GENERAL' ? '一般纳税人（销项-进项）' : '小规模（销售额×征收率）'
                  }`
                : watchTaxType === 'CIT'
                ? '勾选年度汇算清缴时使用 YYYY-FY'
                : undefined
            }
          >
            <Input placeholder={periodPlaceholder} />
          </Form.Item>

          {watchTaxType === 'CIT' && (
            <Form.Item name="isAnnual" label="年度汇算清缴" valuePropName="checked">
              <Switch checkedChildren="年度" unCheckedChildren="季度" />
            </Form.Item>
          )}

          {watchTaxType === 'SURTAX' && (
            <Form.Item name="urbanRate" label="城建税率" rules={[{ required: true }]}>
              <Select options={URBAN_RATE_OPTIONS} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
