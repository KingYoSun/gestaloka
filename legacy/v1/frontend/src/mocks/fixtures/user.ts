import type { User } from '@/api/generated/models'

export const mockUser: User = {
  id: 'test-user-id',
  username: 'testuser',
  email: 'test@example.com',
  is_active: true,
  created_at: new Date('2025-07-17T00:00:00Z'),
  updated_at: new Date('2025-07-17T00:00:00Z'),
}

export const mockAdminUser: User = {
  ...mockUser,
  id: 'admin-user-id',
  username: 'adminuser',
  email: 'admin@example.com',
  roles: ['admin'],
}