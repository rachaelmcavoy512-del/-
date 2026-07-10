import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Table,
  Form,
  Select,
  DatePicker,
  Button,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import axios from 'axios';
import { ReloadOutlined } from '@ant-design/icons';
import { listTaxpayers, TaxpayerSubject } from '../../api/taxpayer';
import { listInvoices, Invoice, InvoiceType, InvoiceDirection } from '../../api/import';

const { RangePicker } = DatePicker;

// 发票类型中文映射
const TYPE_LABEL: Record<InvoiceType, string> = {
  SPECIAL: '增值税专用发票',
  NORMAL: '增值税普通发票',
  ELECTRONIC: '电子发票',
  OTHER: '其他',
};

// 进销项方向中文映射
const DIRECTION_LABEL: Record<InvoiceDirection, string> = {
  INPUT: '进项',
  OUTPUT: '销项',
};

const DIRECTION_COLOR: Record<InvoiceDirection, string> = {
  INPUT: 'blue',
  OUTPUT: 'gold',
};

export default function InvoiceList() {
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [list, setList] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [form] = Form.useForm();

  // 加载纳税人主体列表
  useEffect(() => {
    listTaxpayers()
      .then((res) => setTaxpayers(res.data))
      .catch(() => message.error('加载纳税人主体失败'));
  }, []);

  // 拉取发票列表
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const params: {
        subjectId?: number;
        from?: string;
        to?: string;
        direction?: InvoiceDirection;
        type?: InvoiceType;
        page: number;
        pageSize: number;
      } = { page, pageSize };

      if (values.subjectId) params.subjectId = Number(values.subjectId);
      if (values.direction) params.direction = values.direction as InvoiceDirection;
      if (values.type) params.type = values.type as InvoiceType;
      if (values.range && Array.isArray(values.range) && values.range.length === 2) {
        const [start, end] = values.range as [Dayjs, Dayjs];
        params.from = start.startOf('day').toISOString();
        params.to = end.endOf('day').toISOString();
      }

      const { data } = await listInvoices(params);
      setList(data.items);
      setTotal(data.total);
    } catch (e) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.error : '查询发票失败';
      message.error(msg || '查询发票失败');
    } finally {
      setLoading(false);
    }
  }, [form, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 表格列定义
  const columns: ColumnsType<Invoice> = [
    {
      title: '开票日期',
      dataIndex: 'billingDate',
      key: 'billingDate',
      width: 110,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    { title: '发票代码', dataIndex: 'invoiceCode', key: 'invoiceCode', width: 130 },
    { title: '发票号码', dataIndex: 'invoiceNo', key: 'invoiceNo', width: 110 },
    {
      title: '类型',
      dataIndex: 'invoiceType',
      key: 'invoiceType',
      width: 140,
      render: (v: InvoiceType) => <Tag>{TYPE_LABEL[v] || v}</Tag>,
    },
    {
      title: '方向',
      dataIndex: 'direction',
      key: 'direction',
      width: 80,
      render: (v: InvoiceDirection) => (
        <Tag color={DIRECTION_COLOR[v] || 'default'}>{DIRECTION_LABEL[v] || v}</Tag>
      ),
    },
    { title: '购方名称', dataIndex: 'buyerName', key: 'buyerName', ellipsis: true },
    { title: '销方名称', dataIndex: 'sellerName', key: 'sellerName', ellipsis: true },
    {
      title: '不含税金额',
      dataIndex: 'amountExclTax',
      key: 'amountExclTax',
      width: 120,
      align: 'right',
      render: (v: number) => v?.toFixed(2),
    },
    {
      title: '税额',
      dataIndex: 'taxAmount',
      key: 'taxAmount',
      width: 110,
      align: 'right',
      render: (v: number) => v?.toFixed(2),
    },
    {
      title: '价税合计',
      dataIndex: 'amountInclTax',
      key: 'amountInclTax',
      width: 120,
      align: 'right',
      render: (v: number) => <strong>{v?.toFixed(2)}</strong>,
    },
    {
      title: '税率',
      dataIndex: 'taxRate',
      key: 'taxRate',
      width: 80,
      align: 'right',
      render: (v: number) => (v !== null && v !== undefined ? `${(v * 100).toFixed(0)}%` : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (v: string) => {
        const map: Record<string, string> = { NORMAL: '正常', VOID: '作废', RED: '红冲' };
        const colorMap: Record<string, string> = { NORMAL: 'success', VOID: 'default', RED: 'error' };
        return <Tag color={colorMap[v] || 'default'}>{map[v] || v}</Tag>;
      },
    },
  ];

  return (
    <Card
      title="发票查询"
      extra={
        <Button icon={<ReloadOutlined />} onClick={fetchData}>
          刷新
        </Button>
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
        <Form.Item name="subjectId" label="主体">
          <Select
            allowClear
            placeholder="选择纳税人主体"
            style={{ width: 220 }}
            options={taxpayers.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Form.Item>
        <Form.Item name="range" label="开票日期">
          <RangePicker style={{ width: 240 }} />
        </Form.Item>
        <Form.Item name="direction" label="方向">
          <Select
            allowClear
            placeholder="进项/销项"
            style={{ width: 120 }}
            options={[
              { value: 'INPUT', label: '进项' },
              { value: 'OUTPUT', label: '销项' },
            ]}
          />
        </Form.Item>
        <Form.Item name="type" label="类型">
          <Select
            allowClear
            placeholder="发票类型"
            style={{ width: 160 }}
            options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          />
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

      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        共 {total} 条
      </Typography.Text>

      <Table<Invoice>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 1400 }}
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
    </Card>
  );
}
