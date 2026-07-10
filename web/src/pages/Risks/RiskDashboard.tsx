import { useEffect, useState, useCallback } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Progress, Typography, Select, Space, Button, message, Empty } from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getRiskDashboard, listRiskEvents, scanRisk, type RiskDashboard as DashboardData, type RiskEvent, type RiskLevel, type RiskEventStatus } from '../../api/risk';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';

// 等级标签颜色
const LEVEL_COLOR: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' };
const LEVEL_TEXT: Record<string, string> = { HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' };
// 状态标签
const STATUS_TEXT: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '整改中',
  RESOLVED: '已整改',
  IGNORED: '已忽略',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'gold',
  IN_PROGRESS: 'processing',
  RESOLVED: 'green',
  IGNORED: 'default',
};

export default function RiskDashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentEvents, setRecentEvents] = useState<RiskEvent[]>([]);
  const [subjects, setSubjects] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  // 拉取纳税人主体列表用于筛选
  useEffect(() => {
    listTaxpayers()
      .then((res) => setSubjects(res.data))
      .catch(() => undefined);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, eventsRes] = await Promise.all([
        getRiskDashboard(subjectId),
        listRiskEvents({ subjectId, pageSize: 10 }),
      ]);
      setDashboard(dashRes.data);
      setRecentEvents(eventsRes.data.items);
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '加载失败' : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 手动触发扫描
  const handleScan = async () => {
    if (!subjectId) {
      message.warning('请先选择纳税人主体');
      return;
    }
    setScanning(true);
    try {
      const { data } = await scanRisk(subjectId);
      message.success(`扫描完成：扫描 ${data.scanned} 个指标，命中 ${data.hit} 个风险`);
      fetchData();
    } catch (e) {
      message.error(axios.isAxiosError(e) ? e.response?.data?.error || '扫描失败' : '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const levelTotal = dashboard
    ? dashboard.byLevel.high + dashboard.byLevel.medium + dashboard.byLevel.low
    : 0;

  const columns = [
    {
      title: '指标',
      dataIndex: ['indicator', 'name'],
      key: 'indicator',
      render: (_: unknown, record: RiskEvent) => (
        <a onClick={() => navigate(`/risks/events/${record.id}`)}>{record.indicator.name}</a>
      ),
    },
    {
      title: '主体',
      dataIndex: ['subject', 'name'],
      key: 'subject',
    },
    {
      title: '等级',
      dataIndex: 'level',
      key: 'level',
      width: 90,
      render: (v: RiskLevel) => <Tag color={LEVEL_COLOR[v]}>{LEVEL_TEXT[v]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: RiskEventStatus) => <Tag color={STATUS_COLOR[v]}>{STATUS_TEXT[v]}</Tag>,
    },
    {
      title: '命中值',
      dataIndex: 'metricValue',
      key: 'metricValue',
      ellipsis: true,
      width: 220,
    },
    {
      title: '所属期',
      dataIndex: 'period',
      key: 'period',
      width: 100,
    },
  ];

  return (
    <div>
      <Card
        title="风险监控看板"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="选择纳税人主体"
              style={{ width: 220 }}
              value={subjectId}
              onChange={(v) => setSubjectId(v)}
              options={subjects.map((s) => ({ value: s.id, label: s.name }))}
            />
            <Button icon={<ThunderboltOutlined />} loading={scanning} onClick={handleScan}>
              扫描风险
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>
              刷新
            </Button>
          </Space>
        }
      >
        {/* 顶部统计卡片 */}
        <Row gutter={16}>
          <Col xs={12} sm={8} md={4}>
            <Statistic title="风险总数" value={dashboard?.totalEvents ?? 0} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="高风险"
              value={dashboard?.byLevel.high ?? 0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="中风险"
              value={dashboard?.byLevel.medium ?? 0}
              valueStyle={{ color: '#d4380d' }}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="低风险"
              value={dashboard?.byLevel.low ?? 0}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic
              title="整改率"
              value={dashboard ? (dashboard.remediationRate * 100).toFixed(1) : '0.0'}
              suffix="%"
              valueStyle={{ color: '#3f8600' }}
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Statistic title="待处理" value={dashboard?.byStatus.pending ?? 0} />
          </Col>
        </Row>

        {/* 等级分布 & 状态分布 */}
        <Row gutter={16} style={{ marginTop: 24 }}>
          <Col xs={24} md={12}>
            <Card type="inner" title="风险等级分布">
              {levelTotal > 0 ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text>高风险</Typography.Text>
                    <Progress
                      percent={levelTotal ? Math.round((dashboard!.byLevel.high / levelTotal) * 100) : 0}
                      strokeColor="#cf1322"
                      format={() => `${dashboard!.byLevel.high}`}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text>中风险</Typography.Text>
                    <Progress
                      percent={levelTotal ? Math.round((dashboard!.byLevel.medium / levelTotal) * 100) : 0}
                      strokeColor="#d4380d"
                      format={() => `${dashboard!.byLevel.medium}`}
                    />
                  </div>
                  <div>
                    <Typography.Text>低风险</Typography.Text>
                    <Progress
                      percent={levelTotal ? Math.round((dashboard!.byLevel.low / levelTotal) * 100) : 0}
                      strokeColor="#1677ff"
                      format={() => `${dashboard!.byLevel.low}`}
                    />
                  </div>
                </>
              ) : (
                <Empty description="暂无风险事件" />
              )}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card type="inner" title="风险状态分布">
              {dashboard && dashboard.totalEvents > 0 ? (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text>待处理</Typography.Text>
                    <Progress
                      percent={Math.round((dashboard.byStatus.pending / dashboard.totalEvents) * 100)}
                      strokeColor="#faad14"
                      format={() => `${dashboard.byStatus.pending}`}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text>整改中</Typography.Text>
                    <Progress
                      percent={Math.round((dashboard.byStatus.inProgress / dashboard.totalEvents) * 100)}
                      strokeColor="#1677ff"
                      format={() => `${dashboard.byStatus.inProgress}`}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text>已整改</Typography.Text>
                    <Progress
                      percent={Math.round((dashboard.byStatus.resolved / dashboard.totalEvents) * 100)}
                      strokeColor="#52c41a"
                      format={() => `${dashboard.byStatus.resolved}`}
                    />
                  </div>
                  <div>
                    <Typography.Text>已忽略</Typography.Text>
                    <Progress
                      percent={Math.round((dashboard.byStatus.ignored / dashboard.totalEvents) * 100)}
                      strokeColor="#d9d9d9"
                      format={() => `${dashboard.byStatus.ignored}`}
                    />
                  </div>
                </>
              ) : (
                <Empty description="暂无风险事件" />
              )}
            </Card>
          </Col>
        </Row>

        {/* 近6月趋势 */}
        <Card type="inner" title="近6个月风险事件趋势" style={{ marginTop: 16 }}>
          {dashboard && dashboard.trend.length > 0 ? (
            <Row gutter={8}>
              {dashboard.trend.map((t) => {
                const maxCount = Math.max(...dashboard.trend.map((x) => x.count), 1);
                return (
                  <Col key={t.period} xs={12} sm={8} md={4} style={{ textAlign: 'center' }}>
                    <div style={{ height: 120, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      <div
                        style={{
                          height: `${(t.count / maxCount) * 80}px`,
                          minHeight: t.count > 0 ? 4 : 0,
                          background: '#1677ff',
                          margin: '0 auto',
                          width: '60%',
                          borderRadius: 4,
                        }}
                      />
                      <Typography.Text strong style={{ display: 'block', marginTop: 4 }}>
                        {t.count}
                      </Typography.Text>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t.period}
                    </Typography.Text>
                  </Col>
                );
              })}
            </Row>
          ) : (
            <Empty description="暂无趋势数据" />
          )}
        </Card>

        {/* 最近风险事件 */}
        <Card
          type="inner"
          title="最近风险事件"
          style={{ marginTop: 16 }}
          extra={
            <Button type="link" onClick={() => navigate('/risks/events')}>
              查看全部
            </Button>
          }
        >
          <Table
            rowKey="id"
            loading={loading}
            columns={columns as never}
            dataSource={recentEvents}
            pagination={false}
            size="small"
            locale={{ emptyText: '暂无风险事件' }}
          />
        </Card>
      </Card>
    </div>
  );
}
