import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Home from './pages/Home';
import Placeholder from './pages/Placeholder';
import TaxpayerList from './pages/Taxpayers/TaxpayerList';
import AuditLogList from './pages/AuditLogs/AuditLogList';
import ImportCenter from './pages/Imports/ImportCenter';
import InvoiceList from './pages/Imports/InvoiceList';
import VoucherList from './pages/Vouchers/VoucherList';
import VoucherForm from './pages/Vouchers/VoucherForm';
import VoucherDetail from './pages/Vouchers/VoucherDetail';
import PeriodClose from './pages/Vouchers/PeriodClose';
import TaxReturnList from './pages/TaxReturns/TaxReturnList';
import TaxReturnDetail from './pages/TaxReturns/TaxReturnDetail';
import RiskDashboard from './pages/Risks/RiskDashboard';
import RiskEventList from './pages/Risks/RiskEventList';
import RiskEventDetail from './pages/Risks/RiskEventDetail';
import RiskIndicatorList from './pages/Risks/RiskIndicatorList';
import ReportsHome from './pages/Reports/ReportsHome';
import BalanceSheet from './pages/Reports/BalanceSheet';
import IncomeStatement from './pages/Reports/IncomeStatement';
import CashFlowStatement from './pages/Reports/CashFlowStatement';
import TrialBalance from './pages/Reports/TrialBalance';
import SubsidiaryLedger from './pages/Reports/SubsidiaryLedger';
import MainLayout from './layouts/MainLayout';

// 登录态守卫：无 token 则跳转登录
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="taxpayers" element={<TaxpayerList />} />
          <Route path="vouchers" element={<VoucherList />} />
          <Route path="vouchers/new" element={<VoucherForm />} />
          <Route path="vouchers/period-close" element={<PeriodClose />} />
          <Route path="vouchers/:id" element={<VoucherDetail />} />
          <Route path="reports" element={<ReportsHome />} />
          <Route path="reports/balance-sheet" element={<BalanceSheet />} />
          <Route path="reports/income-statement" element={<IncomeStatement />} />
          <Route path="reports/cash-flow" element={<CashFlowStatement />} />
          <Route path="reports/trial-balance" element={<TrialBalance />} />
          <Route path="reports/subsidiary-ledger" element={<SubsidiaryLedger />} />
          <Route path="imports" element={<ImportCenter />} />
          <Route path="imports/invoices" element={<InvoiceList />} />
          <Route path="tax-returns" element={<TaxReturnList />} />
          <Route path="tax-returns/:id" element={<TaxReturnDetail />} />
          <Route path="risks" element={<RiskDashboard />} />
          <Route path="risks/events" element={<RiskEventList />} />
          <Route path="risks/events/:id" element={<RiskEventDetail />} />
          <Route path="risks/indicators" element={<RiskIndicatorList />} />
          <Route path="audit-log" element={<AuditLogList />} />
          <Route path="users" element={<Placeholder title="用户管理" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
