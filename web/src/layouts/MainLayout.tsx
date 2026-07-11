import { useEffect, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  ThunderboltOutlined,
  BankOutlined,
  FileTextOutlined,
  BarChartOutlined,
  CloudUploadOutlined,
  AuditOutlined,
  AlertOutlined,
  HistoryOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import api from '../api/client';

const { Header, Sider, Content } = Layout;

// 角色中文映射
export const ROLE_LABEL: Record<string, string> = {
  ADMIN: '管理员',
  ACCOUNTANT: '会计',
  AUDITOR: '审计',
  VIEWER: '查询',
};

// 当前用户信息
interface CurrentUser {
  id: number;
  username: string;
  role: string;
}

// 菜单配置：key 为路由路径，roles 为允许可见的角色
interface MenuConfig {
  key: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
}

const ALL_ROLES = ['ADMIN', 'ACCOUNTANT', 'AUDITOR', 'VIEWER'];

const MENU_CONFIG: MenuConfig[] = [
  // 新手友好：智能记账置于首位
  { key: '/smart-book', label: '智能记账', icon: <ThunderboltOutlined />, roles: ALL_ROLES },
  { key: '/taxpayers', label: '纳税人主体', icon: <BankOutlined />, roles: ALL_ROLES },
  { key: '/vouchers', label: '凭证记账', icon: <FileTextOutlined />, roles: ALL_ROLES },
  { key: '/reports', label: '财务报表', icon: <BarChartOutlined />, roles: ALL_ROLES },
  { key: '/imports', label: '数据上传', icon: <CloudUploadOutlined />, roles: ALL_ROLES },
  { key: '/tax-returns', label: '税务申报', icon: <AuditOutlined />, roles: ALL_ROLES },
  { key: '/risks', label: '风险监控', icon: <AlertOutlined />, roles: ALL_ROLES },
  { key: '/audit-logs', label: '审计日志', icon: <HistoryOutlined />, roles: ['ADMIN', 'AUDITOR'] },
  { key: '/users', label: '用户管理', icon: <TeamOutlined />, roles: ['ADMIN'] },
];

export default function MainLayout() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // 获取当前用户信息，失败则跳登录
  useEffect(() => {
    api
      .get<CurrentUser>('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  // 根据角色过滤菜单
  const visibleMenus = MENU_CONFIG.filter((m) => user && m.roles.includes(user.role));

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      navigate('/login', { replace: true });
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible breakpoint="lg">
        <div
          onClick={() => navigate('/')}
          style={{
            height: 48,
            color: '#fff',
            textAlign: 'center',
            lineHeight: '48px',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          税务风险监控
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={visibleMenus.map((m) => ({ key: m.key, icon: m.icon, label: m.label }))}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <Dropdown
            menu={{
              items: [
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
              ],
              onClick: handleMenuClick,
            }}
            placement="bottomRight"
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user?.username}</span>
              <Typography.Text type="secondary">
                {user ? ROLE_LABEL[user.role] : ''}
              </Typography.Text>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: '#fff', borderRadius: 8 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
