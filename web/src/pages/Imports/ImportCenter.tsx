import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Tabs,
  Upload,
  Select,
  Button,
  Table,
  Space,
  Typography,
  Tag,
  Alert,
  DatePicker,
  message,
  Result,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  InboxOutlined,
  DownloadOutlined,
  ReloadOutlined,
  FileExcelOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { listTaxpayers, TaxpayerSubject } from '../../api/taxpayer';
import {
  uploadInvoices,
  uploadBank,
  uploadPayrolls,
  listBatches,
  type ImportBatch,
  type DataType,
  type RowError,
  type UploadResult,
} from '../../api/import';

const { Dragger } = Upload;
const { MonthPicker } = DatePicker;

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

// ============ 模板下载（CSV，带 BOM 以兼容 Excel 中文） ============

// 生成并下载 CSV 模板
function downloadCsvTemplate(fileName: string, headers: string[]) {
  const bom = '\uFEFF';
  const csv = bom + headers.join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// 下载错误行 Excel（用 xlsx 生成）
function downloadErrorExcel(batch: ImportBatch) {
  if (!batch.errors || batch.errors.length === 0) {
    message.info('该批次无错误行');
    return;
  }
  const rows = batch.errors.map((e) => ({ 行号: e.row, 错误原因: e.reason }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '错误行');
  XLSX.writeFile(wb, `错误行_${batch.fileName}_${batch.id}.xlsx`);
}

// 各数据类型模板表头
const TEMPLATE_HEADERS: Record<DataType, string[]> = {
  INVOICE: [
    '发票代码', '发票号码', '发票类型', '方向', '开票日期',
    '购方名称', '销方名称', '购方税号', '销方税号',
    '不含税金额', '税额', '价税合计', '税率',
  ],
  BANK: ['日期', '摘要', '收入', '支出', '对方户名', '对方账号', '银行账号'],
  PAYROLL: ['姓名', '身份证号', '应发', '社保', '公积金', '个税', '实发'],
};

// ============ 上传 Tab 内容 ============

interface UploadTabProps {
  dataType: DataType;
  // 上传函数
  onUpload: (subjectId: number, file: File, period?: string) => Promise<UploadResult>;
  // 是否需要所属期（工资表）
  needPeriod: boolean;
}

function UploadTab({ dataType, onUpload, needPeriod }: UploadTabProps) {
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [period, setPeriod] = useState<Dayjs | null>(dayjs());
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);

  const user = getCurrentUser();
  const canUpload = user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';

  // 加载纳税人主体列表
  useEffect(() => {
    listTaxpayers()
      .then((res) => {
        setTaxpayers(res.data);
        if (res.data.length > 0 && subjectId === undefined) {
          setSubjectId(res.data[0].id);
        }
      })
      .catch(() => message.error('加载纳税人主体失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载批次历史
  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listBatches({ dataType, page, pageSize });
      setBatches(data.items);
      setTotal(data.total);
    } catch (e) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.error : '加载批次失败';
      message.error(msg || '加载批次失败');
    } finally {
      setLoading(false);
    }
  }, [dataType, page, pageSize]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // 处理上传
  const handleUpload = async (file: File) => {
    if (!subjectId) {
      message.warning('请先选择纳税人主体');
      return false;
    }
    if (needPeriod && !period) {
      message.warning('请选择所属期');
      return false;
    }
    setUploading(true);
    try {
      const result = await onUpload(subjectId, file, needPeriod ? period?.format('YYYY-MM') : undefined);
      setLastResult(result);
      message.success(`导入完成：成功 ${result.successCount} 条，失败 ${result.failedCount} 条，跳过 ${result.skippedCount} 条`);
      fetchBatches();
    } catch (e) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.error : '上传失败';
      message.error(msg || '上传失败');
    } finally {
      setUploading(false);
    }
    return false; // 阻止 antd 自动上传
  };

  // 批次表格列
  const columns: ColumnsType<ImportBatch> = [
    { title: '批次ID', dataIndex: 'id', key: 'id', width: 70 },
    { title: '文件名', dataIndex: 'fileName', key: 'fileName', ellipsis: true },
    {
      title: '数据类型',
      dataIndex: 'dataType',
      key: 'dataType',
      width: 90,
      render: (v: DataType) => {
        const map: Record<DataType, string> = { INVOICE: '发票', BANK: '银行流水', PAYROLL: '工资表' };
        return map[v] || v;
      },
    },
    { title: '总数', dataIndex: 'totalCount', key: 'totalCount', width: 70 },
    { title: '成功', dataIndex: 'successCount', key: 'successCount', width: 70, render: (v: number) => <span style={{ color: '#52c41a' }}>{v}</span> },
    { title: '失败', dataIndex: 'failedCount', key: 'failedCount', width: 70, render: (v: number) => (v > 0 ? <span style={{ color: '#ff4d4f' }}>{v}</span> : v) },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const colorMap: Record<string, string> = { DONE: 'success', FAILED: 'error', PROCESSING: 'processing' };
        return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: ImportBatch) =>
        record.errors && record.errors.length > 0 ? (
          <Button
            type="link"
            size="small"
            icon={<FileExcelOutlined />}
            onClick={() => downloadErrorExcel(record)}
          >
            下载错误行
          </Button>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <span>纳税人主体：</span>
        <Select
          style={{ width: 280 }}
          placeholder="选择纳税人主体"
          value={subjectId}
          onChange={(v) => setSubjectId(v)}
          options={taxpayers.map((t) => ({ value: t.id, label: `${t.name}（${t.taxNumber}）` }))}
        />
        {needPeriod && (
          <>
            <span>所属期：</span>
            <MonthPicker
              value={period}
              onChange={(v) => setPeriod(v)}
              format="YYYY-MM"
              placeholder="选择所属期"
            />
          </>
        )}
        <Button
          icon={<DownloadOutlined />}
          onClick={() => downloadCsvTemplate(`模板_${dataType}.csv`, TEMPLATE_HEADERS[dataType])}
        >
          下载模板
        </Button>
        <Button icon={<ReloadOutlined />} onClick={fetchBatches}>
          刷新
        </Button>
      </Space>

      {canUpload ? (
        <Dragger
          accept=".xlsx,.xls,.csv,.xml"
          multiple={false}
          showUploadList={false}
          disabled={uploading}
          beforeUpload={(file) => handleUpload(file as File)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {uploading ? '正在上传并导入...' : '点击或拖拽文件到此区域上传'}
          </p>
          <p className="ant-upload-hint">
            支持 .xlsx / .xls / .csv{dataType === 'INVOICE' ? ' / .xml（税控盘格式）' : ''}，单文件不超过 20MB
          </p>
        </Dragger>
      ) : (
        <Alert
          type="info"
          showIcon
          message="当前角色无上传权限"
          description="仅 ADMIN / ACCOUNTANT 角色可上传数据，您可以查看下方批次历史与错误详情。"
        />
      )}

      {lastResult && (
        <Result
          status={lastResult.failedCount > 0 ? 'warning' : 'success'}
          title={`导入完成：共 ${lastResult.totalCount} 条`}
          subTitle={
            <Space split={<Typography.Text type="secondary">|</Typography.Text>}>
              <Typography.Text type="success">成功 {lastResult.successCount}</Typography.Text>
              <Typography.Text type="warning">跳过(去重) {lastResult.skippedCount}</Typography.Text>
              <Typography.Text type="danger">失败 {lastResult.failedCount}</Typography.Text>
            </Space>
          }
          extra={
            lastResult.errors.length > 0 ? (
              <Button
                icon={<FileExcelOutlined />}
                onClick={() => downloadErrorExcel(lastResult.batch)}
              >
                下载错误行
              </Button>
            ) : null
          }
          style={{ padding: '16px 0' }}
        />
      )}

      <Typography.Title level={5} style={{ marginTop: 16 }}>
        导入批次历史
      </Typography.Title>
      <Table<ImportBatch>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={batches}
        expandable={{
          rowExpandable: (record) => !!record.errors && record.errors.length > 0,
          expandedRowRender: (record) => (
            <Table<RowError>
              rowKey={(r) => `${r.row}-${r.reason}`}
              size="small"
              pagination={false}
              dataSource={record.errors || []}
              columns={[
                { title: '行号', dataIndex: 'row', key: 'row', width: 70 },
                { title: '错误原因', dataIndex: 'reason', key: 'reason' },
              ]}
            />
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}

// ============ 导入中心首页 ============

export default function ImportCenter() {
  const navigate = useNavigate();
  return (
    <Card
      title="数据上传与导入"
      extra={
        <Button icon={<SearchOutlined />} onClick={() => navigate('/imports/invoices')}>
          发票查询
        </Button>
      }
    >
      <Tabs
        defaultActiveKey="INVOICE"
        items={[
          {
            key: 'INVOICE',
            label: '发票',
            children: (
              <UploadTab
                dataType="INVOICE"
                needPeriod={false}
                onUpload={(subjectId, file) => uploadInvoices(subjectId, file).then((r) => r.data)}
              />
            ),
          },
          {
            key: 'BANK',
            label: '银行流水',
            children: (
              <UploadTab
                dataType="BANK"
                needPeriod={false}
                onUpload={(subjectId, file) => uploadBank(subjectId, file).then((r) => r.data)}
              />
            ),
          },
          {
            key: 'PAYROLL',
            label: '工资表',
            children: (
              <UploadTab
                dataType="PAYROLL"
                needPeriod={true}
                onUpload={(subjectId, file, period) =>
                  uploadPayrolls(subjectId, period!, file).then((r) => r.data)
                }
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
