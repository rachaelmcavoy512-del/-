import { Card, Empty, Typography } from 'antd';

// 通用占位页面：后续 Task 将替换为具体业务模块
export default function Placeholder({ title }: { title: string }) {
  return (
    <Card title={title}>
      <Empty
        description={
          <Typography.Text type="secondary">
            「{title}」模块开发中，将在后续任务中实现
          </Typography.Text>
        }
      />
    </Card>
  );
}
