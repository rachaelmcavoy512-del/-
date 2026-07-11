import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Select,
  Tag,
  Typography,
  Spin,
  Empty,
  Alert,
  Statistic,
  Row,
  Col,
  message,
  Popconfirm,
  List,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
  ToolOutlined,
  RightOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getRiskReport,
  generateAdjustmentVoucher,
  rescanRisk,
  type RiskReport as RiskReportData,
  type ReportEvent,
} from '../../api/risk';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';

// 总体评级文案与颜色
const OVERALL_TEXT: Record<string, string> = {
  HIGH: '高风险',
  MEDIUM: '中风险',
  LOW: '低风险',
  HEALTHY: '健康',
};
const OVERALL_COLOR: Record<string, string> = {
  HIGH: '#cf1322',
  MEDIUM: '#d46b08',
  LOW: '#096dd9',
  HEALTHY: '#389e0d',
};

// 单条风险等级颜色
const LEVEL_COLOR: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' };
const LEVEL_TEXT: Record<string, string> = { HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' };

// 状态文案
const STATUS_TEXT: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '整改中',
  RESOLVED: '已整改',
  IGNORED: '已忽略',
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

export default function RiskReport() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSubjectId = searchParams.get('subjectId');
  const [subjects, setSubjects] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(
    urlSubjectId ? Number(urlSubjectId) : undefined
  );
  const [report, setReport] = useState<RiskReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [fixingEventId, setFixingEventId] = useState<number | null>(null);

  const currentUser = getCurrentUser();
  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'ACCOUNTANT';

  // 加载主体列表
  useEffect(() => {
    listTaxpayers()
      .then((res) => {
        setSubjects(res.data);
        if (urlSubjectId) {
          setSubjectId(Number(urlSubjectId));
        } else if (res.data.length > 0 && !subjectId) {
          setSubjectId(res.data[0].id);
        }
      })
      .catch(() => message.error('加载主体列表失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉取报告
  const fetchReport = useCallback(async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const { data } = await getRiskReport(subjectId);
      setReport(data);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载报告失败' : '加载报告失败');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // 切换主体时同步 URL
  const handleSubjectChange = (v: number) => {
    setSubjectId(v);
    setSearchParams({ subjectId: String(v) });
  };

  // 重新体检（重新触发扫描 + 重拉报告）
  const handleRescan = async () => {
    if (!subjectId) return;
    setRescanning(true);
    try {
      await rescanRisk(subjectId);
      message.success('体检完成');
      await fetchReport();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '体检失败' : '体检失败');
    } finally {
      setRescanning(false);
    }
  };

  // 一键生成整改凭证
  const handleGenerateAdjustment = async (ev: ReportEvent) => {
    setFixingEventId(ev.id);
    try {
      await generateAdjustmentVoucher(ev.id, true);
      message.success('已生成整改凭证并过账，事件已结案');
      fetchReport();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '整改失败' : '整改失败');
    } finally {
      setFixingEventId(null);
    }
  };

  // 解析 actionableSteps 为步骤数组
  const parseSteps = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    } catch {
      // 非 JSON 时按换行拆分
      return raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  };

  return (
    <Card
      title={
        <Space>
          <WarningOutlined />
          风险体检报告
        </Space>
      }
      extra={
        <Space>
          <Select
            style={{ width: 240 }}
            placeholder="选择纳税人主体"
            value={subjectId}
            onChange={handleSubjectChange}
            options={subjects.map((s) => ({ value: s.id, label: `${s.name}（${s.taxNumber}）` }))}
          />
          <Tooltip title="重新扫描数据并生成体检报告">
            <Popconfirm
              title="确定重新体检吗？"
              description="将按当前阈值重新扫描并刷新报告"
              onConfirm={handleRescan}
              disabled={!subjectId}
            >
              <Button icon={<ReloadOutlined />} loading={rescanning} disabled={!subjectId}>
                重新体检
              </Button>
            </Popconfirm>
          </Tooltip>
        </Space>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin tip="生成体检报告中..." />
        </div>
      ) : !subjectId ? (
        <Empty description="请先选择纳税人主体" />
      ) : !report ? (
        <Empty description="暂无报告数据" />
      ) : report.events.length === 0 ? (
        // 健康状态：恭喜
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
          <Typography.Title level={3} style={{ color: '#389e0d', marginTop: 16 }}>
            恭喜，未发现税务风险
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            当前主体在 {report.period || '本期'} 未触发任何风险指标，请继续保持。
          </Typography.Paragraph>
          <Row gutter={16} justify="center" style={{ marginTop: 24 }}>
            <Col>
              <Statistic title="总体评级" value="健康" valueStyle={{ color: '#389e0d' }} />
            </Col>
            <Col>
              <Statistic title="风险事件" value={0} />
            </Col>
          </Row>
        </div>
      ) : (
        <>
          {/* 报告头：公司名 + 总体评级 + 统计 */}
          <div
            style={{
              background: '#fafafa',
              padding: 24,
              borderRadius: 8,
              marginBottom: 24,
              borderLeft: `6px solid ${OVERALL_COLOR[report.overallLevel] || '#096dd9'}`,
            }}
          >
            <Row gutter={24} align="middle">
              <Col flex="auto">
                <Typography.Title level={4} style={{ marginBottom: 4 }}>
                  {report.subjectName}
                </Typography.Title>
                <Typography.Text type="secondary">
                  所属期：{report.period || '全部期间'}
                </Typography.Text>
              </Col>
              <Col>
                <Statistic
                  title="总体评级"
                  value={OVERALL_TEXT[report.overallLevel] || report.overallLevel}
                  valueStyle={{
                    color: OVERALL_COLOR[report.overallLevel],
                    fontSize: 32,
                    fontWeight: 700,
                  }}
                />
              </Col>
              <Col>
                <Statistic title="高风险" value={report.byLevel.high} valueStyle={{ color: '#cf1322' }} />
              </Col>
              <Col>
                <Statistic title="中风险" value={report.byLevel.medium} valueStyle={{ color: '#d46b08' }} />
              </Col>
              <Col>
                <Statistic title="低风险" value={report.byLevel.low} valueStyle={{ color: '#096dd9' }} />
              </Col>
              <Col>
                <Statistic title="合计" value={report.totalEvents} />
              </Col>
            </Row>
          </div>

          {/* 风险卡片列表 */}
          <List
            itemLayout="vertical"
            dataSource={report.events}
            renderItem={(ev) => {
              const steps = ev.fixSteps ?? [];
              const actionable = parseSteps(ev.actionableSteps);
              return (
                <List.Item key={ev.id}>
                  <Card
                    size="small"
                    style={{ marginBottom: 12 }}
                    title={
                      <Space>
                        <Tag color={LEVEL_COLOR[ev.level]}>{LEVEL_TEXT[ev.level] || ev.level}</Tag>
                        <Typography.Text strong>{ev.indicatorName}</Typography.Text>
                        <Typography.Text type="secondary">（{ev.indicatorCode}）</Typography.Text>
                      </Space>
                    }
                    extra={
                      <Space>
                        <Tag>{STATUS_TEXT[ev.status] || ev.status}</Tag>
                        {canManage && ev.canAutoFix && ev.status !== 'RESOLVED' && (
                          <Popconfirm
                            title="一键生成整改凭证"
                            description="将自动生成调整凭证并过账，事件标记为已整改。确认继续？"
                            onConfirm={() => handleGenerateAdjustment(ev)}
                          >
                            <Button
                              type="primary"
                              icon={<ToolOutlined />}
                              loading={fixingEventId === ev.id}
                            >
                              一键整改
                            </Button>
                          </Popconfirm>
                        )}
                        <Button
                          type="link"
                          onClick={() => navigate(`/risks/events/${ev.id}`)}
                        >
                          查看详情 <RightOutlined />
                        </Button>
                      </Space>
                    }
                  >
                    {/* 大白话描述 */}
                    {ev.plainDescription && (
                      <Alert
                        type={ev.level === 'HIGH' ? 'error' : ev.level === 'MEDIUM' ? 'warning' : 'info'}
                        showIcon
                        message={ev.plainDescription}
                        style={{ marginBottom: 12 }}
                      />
                    )}

                    {/* 命中指标值 */}
                    <Typography.Paragraph style={{ marginBottom: 8 }}>
                      <Typography.Text type="secondary">当前指标值：</Typography.Text>
                      <Typography.Text strong>{ev.metricValue}</Typography.Text>
                      {ev.thresholdValue && (
                        <>
                          <Typography.Text type="secondary">　阈值：</Typography.Text>
                          <Typography.Text>{ev.thresholdValue}</Typography.Text>
                        </>
                      )}
                    </Typography.Paragraph>

                    {/* 改正步骤 */}
                    {steps.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Typography.Text type="secondary">建议改正步骤：</Typography.Text>
                        <ol style={{ margin: '6px 0 0 20px', padding: 0 }}>
                          {steps.map((s, i) => (
                            <li key={i} style={{ marginBottom: 2 }}>
                              {s}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* 已生成的整改步骤（后端 actionableSteps） */}
                    {actionable.length > 0 && ev.adjustmentVoucherId && (
                      <div style={{ marginBottom: 8 }}>
                        <Typography.Text type="success">已执行整改步骤：</Typography.Text>
                        <ol style={{ margin: '6px 0 0 20px', padding: 0 }}>
                          {actionable.map((s, i) => (
                            <li key={i} style={{ marginBottom: 2 }}>
                              {s}
                            </li>
                          ))}
                        </ol>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => navigate(`/vouchers/${ev.adjustmentVoucherId}`)}
                        >
                          查看调整凭证 #{ev.adjustmentVoucherId}
                        </Button>
                      </div>
                    )}

                    {/* 后端原始建议（如有多余信息） */}
                    {ev.suggestion && !ev.plainDescription && (
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {ev.suggestion}
                      </Typography.Paragraph>
                    )}
                  </Card>
                </List.Item>
              );
            }}
          />
        </>
      )}
    </Card>
  );
}
