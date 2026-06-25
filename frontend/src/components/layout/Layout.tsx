import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useRealtime } from '../../hooks/useRealtime';
import { useAlarmNotifications } from '../../hooks/useAlarmNotifications';

export default function Layout() {
  useRealtime();
  useAlarmNotifications();

  return (
    <div className="flex h-screen overflow-hidden bg-mine-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
