import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Typography,
  Spin,
  Tag,
  Row,
  Col,
  Button,
  Space,
  Empty,
  Modal,
  Form,
  Input,
  Select,
  message,
  Tooltip,
  Statistic,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  ThunderboltOutlined,
  AlertOutlined,
  FileTextOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  getTaxpayerSummary,
  quickCreateTaxpayer,
  type TaxpayerSummary,
  type TaxpayerType,
} from '../api/taxpayer';
import { ROLE_LABEL } from '../layouts/MainLayout';

// 当前用户信息
interface CurrentUser {
  id: number;
  username: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
}

// 纳税人类型文案
const TAXPAYER_TYPE_TEXT: Record<string, string> = {
  GENERAL: '一般纳税人',
  SMALL_SCALE: '小规模纳税人',
};

export default function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TaxpayerSummary[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const isAdmin =
    user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';

  // 加载用户信息（本地优先，避免拉取失败时整页空白）
  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (raw) {
      try {
        setUser(JSON.parse(raw) as CurrentUser);
      } catch {
        /* ignore */
      }
    }
    // 不再强依赖 /auth/me，主体加载才是首页重点
    setLoading(false);
  }, []);

  // 加载公司统计
  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await getTaxpayerSummary();
      setSummary(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载主体失败' : '加载主体失败');
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // 创建公司
  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await quickCreateTaxpayer({
        name: values.name.trim(),
        taxNumber: values.taxNumber.trim(),
        taxpayerType: values.taxpayerType as TaxpayerType,
      });
      message.success('公司创建成功，已自动初始化科目体系');
      setCreateModalOpen(false);
      form.resetFields();
      fetchSummary();
    } catch (e) {
      if (axios.isAxiosError(e)) {
        message.error(e.response?.data?.error || '创建失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      {/* 顶部欢迎条 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Typography.Title level={4} style={{ marginBottom: 0 }}>
              欢迎使用「记账报税与税务风险监控系统」
            </Typography.Title>
            <Typography.Text type="secondary">
              当前用户：{user?.username}　
              <Tag color={user?.role === 'ADMIN' ? 'red' : 'blue'}>
                {user ? ROLE_LABEL[user.role] || user.role : ''}
              </Tag>
            </Typography.Text>
          </Col>
          <Col>
            <Space>
              {isAdmin && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateModalOpen(true)}
                >
                  新建公司
                </Button>
              )}
              <Tooltip title="进入传统多模块操作界面">
                <Button icon={<SettingOutlined />} onClick={() => navigate('/taxpayers')}>
                  专业模式
                </Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 公司卡片列表 */}
      {summary.length === 0 ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" align="center">
                <Typography.Text>还没有公司，先创建一家开始记账吧</Typography.Text>
                {isAdmin && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setCreateModalOpen(true)}
                  >
                    新建公司
                  </Button>
                )}
              </Space>
            }
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {summary.map((s) => (
            <Col xs={24} sm={12} lg={8} key={s.id}>
              <Card
                title={
                  <Space>
                    <Typography.Text strong>{s.name}</Typography.Text>
                    <Tag color={s.taxpayerType === 'GENERAL' ? 'geekblue' : 'green'}>
                      {TAXPAYER_TYPE_TEXT[s.taxpayerType] || s.taxpayerType}
                    </Tag>
                  </Space>
                }
                extra={<Typography.Text type="secondary">{s.taxNumber}</Typography.Text>}
                actions={[
                  <Tooltip title="一键生成记账凭证" key="book">
                    <ThunderboltOutlined onClick={() => navigate(`/smart-book?subjectId=${s.id}`)} />
                  </Tooltip>,
                  <Tooltip title="风险体检报告" key="risk">
                    <AlertOutlined onClick={() => navigate(`/risks/report?subjectId=${s.id}`)} />
                  </Tooltip>,
                  <Tooltip title="查看凭证列表" key="voucher">
                    <FileTextOutlined onClick={() => navigate(`/vouchers?subjectId=${s.id}`)} />
                  </Tooltip>,
                  <Tooltip title="进入详情" key="more">
                    <RightOutlined onClick={() => navigate(`/taxpayers`)} />
                  </Tooltip>,
                ]}
              >
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic
                      title="风险"
                      value={s.riskCount}
                      valueStyle={s.riskCount > 0 ? { color: '#cf1322' } : { color: '#52c41a' }}
                      suffix={s.riskCount > 0 ? '项' : ''}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic title="凭证" value={s.voucherCount} suffix="张" />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="最近申报"
                      value={s.lastReportPeriod || '-'}
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                </Row>
                <Divider style={{ margin: '12px 0' }} />
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button
                    block
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => navigate(`/smart-book?subjectId=${s.id}`)}
                  >
                    进入记账
                  </Button>
                  <Button
                    block
                    icon={<AlertOutlined />}
                    onClick={() => navigate(`/risks/report?subjectId=${s.id}`)}
                  >
                    一键风险体检
                  </Button>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 新建公司 Modal */}
      <Modal
        title="快速新建公司"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalOpen(false);
          form.resetFields();
        }}
        confirmLoading={submitting}
        okText="创建"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary">
          只需填写三项必填信息，系统会自动初始化对应的会计科目体系。
        </Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ taxpayerType: 'SMALL_SCALE' }}>
          <Form.Item
            name="name"
            label="公司名称"
            rules={[{ required: true, message: '请输入公司名称' }]}
          >
            <Input placeholder="例如：杭州某某科技有限公司" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="taxNumber"
            label="纳税人识别号"
            rules={[
              { required: true, message: '请输入纳税人识别号' },
              { len: 18, message: '统一社会信用代码为 18 位' },
            ]}
          >
            <Input placeholder="18 位统一社会信用代码" maxLength={18} />
          </Form.Item>
          <Form.Item
            name="taxpayerType"
            label="纳税人类型"
            rules={[{ required: true, message: '请选择纳税人类型' }]}
          >
            <Select
              options={[
                { value: 'SMALL_SCALE', label: '小规模纳税人' },
                { value: 'GENERAL', label: '一般纳税人' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
