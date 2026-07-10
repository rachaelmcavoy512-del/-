// 增值税申报表详情（Task6）
// 一般纳税人：显示附列资料(一)-(五) + 主表；小规模：显示简化表
import { Table, Descriptions, Card, Empty, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

// 附列资料(一) 行
interface Schedule1Row {
  taxRate: number;
  salesAmount: number;
  outputTax: number;
  invoiceCount: number;
}

// 通用金额格式化
function money(v: unknown): string {
  const n = Number(v);
  return Number.isNaN(n) ? '-' : n.toFixed(2);
}

// 百分比格式化
function pct(v: unknown): string {
  const n = Number(v);
  return Number.isNaN(n) ? '-' : `${(n * 100).toFixed(2)}%`;
}

// 增值税申报表详情组件
// reportData 为后端生成的结构化数据
export default function VATReturnDetail({
  reportData,
}: {
  reportData: Record<string, unknown> | null | undefined;
}) {
  if (!reportData) {
    return <Empty description="无申报数据" />;
  }

  const taxpayerType = reportData.taxpayerType as string | undefined;
  const data = reportData as Record<string, any>;

  if (taxpayerType === 'GENERAL') {
    return <GeneralVATView data={data} />;
  }
  return <SmallScaleVATView data={data} />;
}

// 一般纳税人增值税申报表视图
function GeneralVATView({ data }: { data: Record<string, any> }) {
  const schedule1 = data.schedule1 ?? {};
  const schedule2 = data.schedule2 ?? {};
  const schedule3 = data.schedule3 ?? {};
  const schedule4 = data.schedule4 ?? {};
  const schedule5 = data.schedule5 ?? {};
  const mainForm = data.mainForm ?? {};

  const s1Columns: ColumnsType<Schedule1Row> = [
    {
      title: '税率',
      dataIndex: 'taxRate',
      key: 'taxRate',
      width: 100,
      render: (v: number) => pct(v),
    },
    {
      title: '销售额(不含税)',
      dataIndex: 'salesAmount',
      key: 'salesAmount',
      align: 'right',
      render: (v: number) => money(v),
    },
    {
      title: '销项税额',
      dataIndex: 'outputTax',
      key: 'outputTax',
      align: 'right',
      render: (v: number) => money(v),
    },
    {
      title: '发票数量',
      dataIndex: 'invoiceCount',
      key: 'invoiceCount',
      width: 90,
      align: 'right',
    },
  ];

  return (
    <div>
      <Card size="small" title={schedule1.title ?? '附列资料(一) 销售额及销项税额'} style={{ marginBottom: 12 }}>
        <Table<Schedule1Row>
          rowKey={(r) => String(r.taxRate)}
          size="small"
          pagination={false}
          columns={s1Columns}
          dataSource={schedule1.rows ?? []}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong>{money(schedule1.invoiceSalesTotal)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>{money(schedule1.invoiceOutputTaxTotal)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
            </Table.Summary.Row>
          )}
        />
        <Descriptions size="small" column={2} style={{ marginTop: 12 }}>
          <Descriptions.Item label="凭证销项税额合计">
            {money(schedule1.voucherOutputTax)}
          </Descriptions.Item>
          <Descriptions.Item label="主表采用销项税额">
            <Text strong>{money(schedule1.outputTaxUsed)}</Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title={schedule2.title ?? '附列资料(二) 进项税额'} style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="认证抵扣进项(发票口径)">
            {money(schedule2.certifiedInput)}
          </Descriptions.Item>
          <Descriptions.Item label="未抵扣进项">{money(schedule2.uncertifiedInput)}</Descriptions.Item>
          <Descriptions.Item label="进项发票数量">{schedule2.invoiceCount ?? 0}</Descriptions.Item>
          <Descriptions.Item label="凭证进项税额合计">
            {money(schedule2.voucherInputTax)}
          </Descriptions.Item>
          <Descriptions.Item label="主表采用进项税额" span={2}>
            <Text strong>{money(schedule2.inputTaxUsed)}</Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={3} bordered>
          <Descriptions.Item label={schedule3.title ?? '附列资料(三) 待抵扣进项'}>
            {money(schedule3.amount)}
          </Descriptions.Item>
          <Descriptions.Item label={schedule4.title ?? '附列资料(四) 抵减台账'}>
            {money(schedule4.amount)}
          </Descriptions.Item>
          <Descriptions.Item label={schedule5.title ?? '附列资料(五) 不动产抵扣'}>
            {money(schedule5.amount)}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title={mainForm.title ?? '增值税纳税申报表主表'}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="期初留抵税额">
            {money(mainForm['期初留抵税额'])}
          </Descriptions.Item>
          <Descriptions.Item label="本期销项税额">
            {money(mainForm['本期销项税额'])}
          </Descriptions.Item>
          <Descriptions.Item label="本期进项税额">
            {money(mainForm['本期进项税额'])}
          </Descriptions.Item>
          <Descriptions.Item label="应抵扣税额合计">
            {money(mainForm['应抵扣税额合计'])}
          </Descriptions.Item>
          <Descriptions.Item label="实际抵扣税额">
            {money(mainForm['实际抵扣税额'])}
          </Descriptions.Item>
          <Descriptions.Item label="期末留抵税额">
            {money(mainForm['期末留抵税额'])}
          </Descriptions.Item>
          <Descriptions.Item label="应纳税额" span={2}>
            <Text strong style={{ fontSize: 16, color: '#cf1322' }}>
              {money(mainForm['应纳税额'])}
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}

// 小规模纳税人增值税申报表视图
function SmallScaleVATView({ data }: { data: Record<string, any> }) {
  const mainForm = data.mainForm ?? {};
  return (
    <Card size="small" title={mainForm.title ?? '增值税纳税申报表(小规模纳税人)主表'}>
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label="凭证销售额(不含税)">{money(data.voucherRevenue)}</Descriptions.Item>
        <Descriptions.Item label="发票销售额(不含税)">{money(data.invoiceSales)}</Descriptions.Item>
        <Descriptions.Item label="销项发票数量">{data.invoiceCount ?? 0}</Descriptions.Item>
        <Descriptions.Item label="征收率">{pct(mainForm['征收率'])}</Descriptions.Item>
        <Descriptions.Item label="销售额">
          <Text strong>{money(mainForm['销售额'])}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="应纳税额">
          <Text strong style={{ fontSize: 16, color: '#cf1322' }}>
            {money(mainForm['应纳税额'])}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="本期预缴">{money(mainForm['本期预缴'])}</Descriptions.Item>
        <Descriptions.Item label="本期应补退税额">
          {money(mainForm['本期应补退税额'])}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
