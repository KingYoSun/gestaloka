import type { User } from '@/api/generated/models'

export const mockUser: User = {
  id: 'test-user-id',
  email: 'test@example.com',
  is_active: true,
  is_admin: false,
  created_at: '2025-07-17T00:00:00Z',
  updated_at: '2025-07-17T00:00:00Z',
}

export const mockAdminUser: User = {
  ...mockUser,
  id: 'admin-user-id',
  email: 'admin@example.com',
  is_admin: true,
}