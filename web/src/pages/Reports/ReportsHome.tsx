// 报表中心首页（Task4）
// 卡片入口选择报表类型，含主体与期间选择器（年+月/季/年）
import { useEffect, useState } from 'react';
import { Card, Row, Col, Select, DatePicker, Radio, Typography, Space, message } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  ProfileOutlined,
  FundOutlined,
  DollarOutlined,
  ReconciliationOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { listTaxpayers, type TaxpayerSubject } from '../../api/taxpayer';
import type { RangeType } from '../../api/report';

const { Title, Text } = Typography;

// 报表卡片配置
const REPORT_CARDS = [
  {
    key: 'balance-sheet',
    title: '资产负债表',
    desc: '反映企业特定日期财务状况，资产=负债+所有者权益',
    icon: <ProfileOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    path: '/reports/balance-sheet',
  },
  {
    key: 'income-statement',
    title: '利润表',
    desc: '反映企业一定期间经营成果，收入-费用=利润',
    icon: <FundOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    path: '/reports/income-statement',
  },
  {
    key: 'cash-flow',
    title: '现金流量表',
    desc: '反映企业现金收支，按经营/投资/筹资活动分类',
    icon: <DollarOutlined style={{ fontSize: 32, color: '#faad14' }} />,
    path: '/reports/cash-flow',
  },
  {
    key: 'trial-balance',
    title: '试算平衡表',
    desc: '科目余额表，校验借方合计=贷方合计',
    icon: <ReconciliationOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
    path: '/reports/trial-balance',
  },
  {
    key: 'subsidiary-ledger',
    title: '明细账',
    desc: '按科目逐笔展示凭证分录，含期初期末余额',
    icon: <UnorderedListOutlined style={{ fontSize: 32, color: '#13c2c2' }} />,
    path: '/reports/subsidiary-ledger',
  },
];

// 全局选中的期间参数（通过 URL query 传递给各报表页）
export default function ReportsHome() {
  const navigate = useNavigate();
  const [taxpayers, setTaxpayers] = useState<TaxpayerSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>(undefined);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [rangeType, setRangeType] = useState<RangeType>('MONTH');

  useEffect(() => {
    listTaxpayers()
      .then((res) => setTaxpayers(res.data))
      .catch(() => {
        /* ignore */
      });
  }, []);

  // 跳转到具体报表，携带选中的参数
  const goReport = (path: string) => {
    if (!subjectId) {
      message.warning('请先选择纳税人主体');
      return;
    }
    const year = month.year();
    const period = month.month() + 1;
    navigate(`${path}?subjectId=${subjectId}&year=${year}&period=${period}&rangeType=${rangeType}`);
  };

  return (
    <div>
      <Title level={4}>财务报表中心</Title>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <span>
            <Text type="secondary">纳税人主体：</Text>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择纳税人主体"
              style={{ width: 260, marginLeft: 8 }}
              value={subjectId}
              onChange={(v) => setSubjectId(v)}
              options={taxpayers.map((t) => ({ value: t.id, label: t.name }))}
            />
          </span>
          <span>
            <Text type="secondary">期间：</Text>
            <DatePicker
              picker="month"
              value={month}
              onChange={(v) => v && setMonth(v)}
              allowClear={false}
              style={{ marginLeft: 8 }}
            />
          </span>
          <span>
            <Text type="secondary">范围：</Text>
            <Radio.Group
              value={rangeType}
              onChange={(e) => setRangeType(e.target.value as RangeType)}
              style={{ marginLeft: 8 }}
            >
              <Radio.Button value="MONTH">单月</Radio.Button>
              <Radio.Button value="QUARTER">季度</Radio.Button>
              <Radio.Button value="YEAR">年度</Radio.Button>
            </Radio.Group>
          </span>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {REPORT_CARDS.map((c) => (
          <Col xs={24} sm={12} lg={8} key={c.key}>
            <Card
              hoverable
              onClick={() => goReport(c.path)}
              styles={{ body: { padding: 24 } }}
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {c.icon}
                <Title level={5} style={{ margin: 0 }}>
                  {c.title}
                </Title>
                <Text type="secondary">{c.desc}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginTop: 16 }}>
        <Text type="secondary">
          提示：报表基于已过账凭证实时计算，凭证过账/红冲/作废后下次查询自动反映最新数据。
        </Text>
      </Card>
    </div>
  );
}
