import { useAuthStore } from '../store';

export function useRole() {
  const { user } = useAuthStore();
  const role = user?.role ?? '';

  return {
    role,
    isAdmin:      role === 'ADMIN',
    isDispatcher: role === 'ADMIN' || role === 'DISPATCHER',
    isViewer:     role !== 'ADMIN' && role !== 'DISPATCHER',
  };
}
