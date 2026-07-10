// 税务申报详情（Task6）
// 通用申报详情：按 taxType 渲染对应表格；VAT 委托 VATReturnDetail 渲染
// 状态操作：提交申报(DRAFT→PENDING) / 标记已申报(PENDING→FILED) / 标记已缴款(FILED→PAID)
import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Descriptions,
  Button,
  Space,
  Tag,
  Spin,
  Typography,
  Popconfirm,
  Modal,
  Input,
  message,
  Empty,
  Table,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getTaxReturn,
  updateTaxReturnStatus,
  exportTaxReturnUrl,
  type TaxReturn,
  type TaxReturnStatus,
  STATUS_LABEL,
  STATUS_COLOR,
  TAX_TYPE_LABEL,
} from '../../api/taxReturn';
import VATReturnDetail from './VATReturnDetail';

const { Text } = Typography;

// 金额格式化
function money(v: unknown): string {
  const n = Number(v);
  return Number.isNaN(n) ? '-' : n.toFixed(2);
}

// 百分比格式化
function pct(v: unknown): string {
  const n = Number(v);
  return Number.isNaN(n) ? '-' : `${(n * 100).toFixed(2)}%`;
}

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

export default function TaxReturnDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const taxReturnId = Number(id);
  const [record, setRecord] = useState<TaxReturn | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [paymentVoucher, setPaymentVoucher] = useState('');

  const currentUser = getCurrentUser();
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT';

  const fetchDetail = useCallback(async () => {
    if (Number.isNaN(taxReturnId)) return;
    setLoading(true);
    try {
      const { data } = await getTaxReturn(taxReturnId);
      setRecord(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [taxReturnId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // 状态流转
  const handleStatusChange = async (target: TaxReturnStatus, voucher?: string) => {
    setActionLoading(true);
    try {
      await updateTaxReturnStatus(taxReturnId, {
        status: target,
        paymentVoucher: voucher ?? null,
      });
      message.success('状态更新成功');
      setPayModalOpen(false);
      setPaymentVoucher('');
      fetchDetail();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '操作失败' : '操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  // 导出 Excel（带 token fetch 下载）
  const handleExport = async () => {
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(exportTaxReturnUrl(taxReturnId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || '导出失败');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disp = resp.headers.get('Content-Disposition') || '';
      const match = disp.match(/filename="?([^"]+)"?/);
      a.download = match ? decodeURIComponent(match[1]) : '申报表.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!record) {
    return (
      <Card>
        <Typography.Text type="secondary">申报记录不存在</Typography.Text>
        <div style={{ marginTop: 16 }}>
          <Button onClick={() => navigate('/tax-returns')}>返回列表</Button>
        </div>
      </Card>
    );
  }

  const status = record.status;

  return (
    <Card
      title={`${TAX_TYPE_LABEL[record.taxType] ?? record.taxType} 申报 - ${record.period}`}
      extra={
        <Space>
          <Button onClick={() => navigate('/tax-returns')}>返回列表</Button>
          <Button onClick={handleExport}>导出 Excel</Button>
          {canManage && status === 'DRAFT' && (
            <Popconfirm title="确认提交申报？状态将变为待申报" onConfirm={() => handleStatusChange('PENDING')}>
              <Button type="primary" loading={actionLoading}>
                提交申报
              </Button>
            </Popconfirm>
          )}
          {canManage && status === 'PENDING' && (
            <Popconfirm title="确认标记为已申报？" onConfirm={() => handleStatusChange('FILED')}>
              <Button type="primary" loading={actionLoading}>
                标记已申报
              </Button>
            </Popconfirm>
          )}
          {canManage && status === 'FILED' && (
            <Button type="primary" loading={actionLoading} onClick={() => setPayModalOpen(true)}>
              标记已缴款
            </Button>
          )}
        </Space>
      }
    >
      <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="纳税人主体">
          {record.subject ? `${record.subject.name}` : `#${record.subjectId}`}
        </Descriptions.Item>
        <Descriptions.Item label="纳税人识别号">
          {record.subject?.taxNumber ?? '-'}
        </Descriptions.Item>
        <Descriptions.Item label="纳税人类型">
          {record.subject?.taxpayerType === 'GENERAL' ? '一般纳税人' : '小规模纳税人'}
        </Descriptions.Item>
        <Descriptions.Item label="税种">{record.taxTypeLabel}</Descriptions.Item>
        <Descriptions.Item label="税款所属期">{record.period}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="应纳税额">
          <Text strong style={{ color: '#cf1322' }}>
            {money(record.taxAmount)}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="申报时间">
          {record.filedAt ? dayjs(record.filedAt).format('YYYY-MM-DD HH:mm') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="缴款时间">
          {record.paidAt ? dayjs(record.paidAt).format('YYYY-MM-DD HH:mm') : '-'}
        </Descriptions.Item>
        {record.paymentVoucher && (
          <Descriptions.Item label="缴款凭证号" span={3}>
            {record.paymentVoucher}
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* 按税种渲染申报表 */}
      {record.taxType === 'VAT' ? (
        <VATReturnDetail reportData={record.reportData} />
      ) : (
        <GenericReturnView taxType={record.taxType} reportData={record.reportData} />
      )}

      {/* 缴款凭证输入 Modal */}
      <Modal
        title="标记已缴款"
        open={payModalOpen}
        onCancel={() => setPayModalOpen(false)}
        confirmLoading={actionLoading}
        onOk={() => handleStatusChange('PAID', paymentVoucher || undefined)}
      >
        <Input
          placeholder="请输入缴款凭证号（可选）"
          value={paymentVoucher}
          onChange={(e) => setPaymentVoucher(e.target.value)}
          maxLength={100}
        />
      </Modal>
    </Card>
  );
}

// 通用申报表视图（CIT / SURTAX / IIT / STAMP）
function GenericReturnView({
  taxType,
  reportData,
}: {
  taxType: string;
  reportData: Record<string, unknown> | null | undefined;
}) {
  if (!reportData) {
    return <Empty description="无申报数据" />;
  }
  const data = reportData as Record<string, any>;

  if (taxType === 'CIT') {
    return (
      <Card size="small" title={`企业所得税申报表（${data.declarationType ?? '季度预缴'}）`}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="营业收入">{money(data.revenue)}</Descriptions.Item>
          <Descriptions.Item label="营业成本">{money(data.cost)}</Descriptions.Item>
          <Descriptions.Item label="期间费用合计">{money(data.expenses)}</Descriptions.Item>
          <Descriptions.Item label="利润总额">
            <Text strong>{money(data.profit)}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="适用税率">{pct(data.taxRate)}</Descriptions.Item>
          <Descriptions.Item label="应纳税所得额">{money(data.taxableIncome)}</Descriptions.Item>
          <Descriptions.Item label="应纳所得税额" span={2}>
            <Text strong style={{ fontSize: 16, color: '#cf1322' }}>
              {money(data.taxAmount)}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="优惠说明" span={2}>
            {data.preferentialDetail ?? '-'}
          </Descriptions.Item>
        </Descriptions>
        {data.expenseDetail && (
          <Descriptions size="small" column={2} style={{ marginTop: 12 }} title="期间费用明细">
            <Descriptions.Item label="税金及附加">
              {money(data.expenseDetail['税金及附加'])}
            </Descriptions.Item>
            <Descriptions.Item label="销售费用">{money(data.expenseDetail['销售费用'])}</Descriptions.Item>
            <Descriptions.Item label="管理费用">{money(data.expenseDetail['管理费用'])}</Descriptions.Item>
            <Descriptions.Item label="财务费用">{money(data.expenseDetail['财务费用'])}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>
    );
  }

  if (taxType === 'SURTAX') {
    const columns: ColumnsType<any> = [
      { title: '税目', dataIndex: 'name', key: 'name' },
      {
        title: '税率',
        dataIndex: 'rate',
        key: 'rate',
        align: 'right',
        render: (v: number) => pct(v),
      },
      {
        title: '金额',
        dataIndex: 'amount',
        key: 'amount',
        align: 'right',
        render: (v: number) => money(v),
      },
      { title: '对应科目', dataIndex: 'account', key: 'account' },
    ];
    return (
      <Card size="small" title="附加税申报表">
        <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
          <Descriptions.Item label="计税依据(应纳增值税额)">{money(data.vatPayable)}</Descriptions.Item>
          <Descriptions.Item label="城建税率">{pct(data.cityRate)}</Descriptions.Item>
        </Descriptions>
        <Table
          rowKey="name"
          size="small"
          pagination={false}
          columns={columns}
          dataSource={data.items ?? []}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{money(data.total)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
            </Table.Summary.Row>
          )}
        />
      </Card>
    );
  }

  if (taxType === 'IIT') {
    return (
      <Card size="small" title="个人所得税扣缴申报表">
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="人数">{data.headcount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="应发工资合计">{money(data.grossSalary)}</Descriptions.Item>
          <Descriptions.Item label="社保合计">{money(data.socialInsurance)}</Descriptions.Item>
          <Descriptions.Item label="公积金合计">{money(data.housingFund)}</Descriptions.Item>
          <Descriptions.Item label="实发工资合计">{money(data.netSalary)}</Descriptions.Item>
          <Descriptions.Item label="代扣个税合计">
            <Text strong style={{ fontSize: 16, color: '#cf1322' }}>
              {money(data.taxWithheld)}
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    );
  }

  if (taxType === 'STAMP') {
    return (
      <Card size="small" title="印花税申报表">
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="购销合同金额">{money(data.contractAmount)}</Descriptions.Item>
          <Descriptions.Item label="税率">{pct(data.rate)}</Descriptions.Item>
          <Descriptions.Item label="发票数量">{data.invoiceCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="应纳印花税">
            <Text strong style={{ fontSize: 16, color: '#cf1322' }}>
              {money(data.taxAmount)}
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    );
  }

  return <Empty description="暂不支持的税种展示" />;
}
