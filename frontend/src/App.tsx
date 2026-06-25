import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import CommandCenter from './pages/CommandCenter';
import Equipment from './pages/Equipment';
import Dispatch from './pages/Dispatch';
import MineMap from './pages/MineMap';
import Maintenance from './pages/Maintenance';
import Fuel from './pages/Fuel';
import Reports from './pages/Reports';
import Operators from './pages/Operators';
import Tyres from './pages/Tyres';
import Shifts from './pages/Shifts';
import Telemetry from './pages/Telemetry';
import Production from './pages/Production';
import Roads from './pages/Roads';
import Settings from './pages/Settings';
import Simulation from './pages/Simulation';
import AIPredictions from './pages/AIPredictions';
import ProductionMonitor from './pages/ProductionMonitor';
import MaterialTracking  from './pages/MaterialTracking';
import DelayAccounting   from './pages/DelayAccounting';
import SpeedMonitor      from './pages/SpeedMonitor';
import ShiftReportPage   from './pages/ShiftReportPage';
import TKPHDashboard     from './pages/TKPHDashboard';
import DispatchConsole   from './pages/DispatchConsole';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Redirection racine → Command Center */}
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* ── 8 pages principales dans la sidebar ──────────────── */}
          <Route path="dashboard"      element={<CommandCenter />} />
          <Route path="map"            element={<MineMap />} />
          <Route path="simulation"     element={<Simulation />} />
          <Route path="equipment"      element={<Equipment />} />
          <Route path="production"     element={<Production />} />
          <Route path="speed"          element={<SpeedMonitor />} />
          <Route path="ai-predictions" element={<AIPredictions />} />
          <Route path="reports"        element={<Reports />} />

          {/* ── Pages secondaires (accessibles via liens internes) ── */}
          <Route path="maintenance"       element={<Maintenance />} />
          <Route path="dispatch"          element={<Dispatch />} />
          <Route path="fuel"              element={<Fuel />} />
          <Route path="operators"         element={<Operators />} />
          <Route path="tyres"             element={<Tyres />} />
          <Route path="shifts"            element={<Shifts />} />
          <Route path="telemetry"         element={<Telemetry />} />
          <Route path="roads"             element={<Roads />} />
          <Route path="production-monitor" element={<ProductionMonitor />} />
          <Route path="material"          element={<MaterialTracking />} />
          <Route path="delays"            element={<DelayAccounting />} />
          <Route path="shift-reports"     element={<ShiftReportPage />} />
          <Route path="tyres-tkph"        element={<TKPHDashboard />} />
          <Route path="dispatch-console"  element={<DispatchConsole />} />
          <Route path="settings"          element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
