import { useEffect, useState } from 'react';
import { Card, Typography, Descriptions, Spin, Tag } from 'antd';
import api from '../api/client';
import { ROLE_LABEL } from '../layouts/MainLayout';

interface CurrentUser {
  id: number;
  username: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
}

const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'red',
  ACCOUNTANT: 'blue',
  AUDITOR: 'orange',
  VIEWER: 'default',
};

export default function Home() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<CurrentUser>('/auth/me')
      .then((res) => setUser(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card title="工作台">
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : user ? (
        <>
          <Typography.Paragraph>
            欢迎使用「记账报税与税务风险监控系统」，当前登录用户：
            <strong>{user.username}</strong>
          </Typography.Paragraph>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="用户ID">{user.id}</Descriptions.Item>
            <Descriptions.Item label="用户名">{user.username}</Descriptions.Item>
            <Descriptions.Item label="角色">
              <Tag color={ROLE_COLOR[user.role] || 'default'}>
                {ROLE_LABEL[user.role] || user.role}
              </Tag>
            </Descriptions.Item>
            {user.createdAt ? (
              <Descriptions.Item label="创建时间">
                {user.createdAt}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
            提示：请通过左侧菜单进入各业务模块。
          </Typography.Paragraph>
        </>
      ) : (
        <Typography.Text type="danger">无法获取用户信息</Typography.Text>
      )}
    </Card>
  );
}
