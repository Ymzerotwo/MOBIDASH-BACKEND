import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamService } from '../../src/services/team.services';

// Mock DB and KV
const mockDb = {
  prepare: vi.fn(),
};

const mockKV = {
  list: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

// Mock crypto helper
vi.mock('../../src/utils/crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_password'),
}));

describe('TeamService Security Rules & Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should query audit log fields and LEFT JOIN if requester is Admin', async () => {
      const currentUser = { id: 'admin1', role: 'Admin' };
      const mockAll = vi.fn().mockResolvedValue({ results: [] });
      const mockFirst = vi.fn().mockResolvedValue({ total: 0 });
      
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        all: mockAll,
        first: mockFirst,
      }));

      await TeamService.getAll(mockDb as any, '', 1, 10, 'all', currentUser);

      // Verify LEFT JOINs and audit fields are present in the pagination query
      const calledQueries = mockDb.prepare.mock.calls.map(call => call[0]);
      const selectQuery = calledQueries.find(q => q.includes('SELECT') && q.includes('u.id'));
      
      expect(selectQuery).toBeDefined();
      expect(selectQuery).toContain('password_updated_by');
      expect(selectQuery).toContain('banned_by');
      expect(selectQuery).toContain('created_by');
      expect(selectQuery).toContain('updated_by');
      expect(selectQuery).toContain('LEFT JOIN Users');
    });

    it('should NOT query audit log fields if requester is User', async () => {
      const currentUser = { id: 'user1', role: 'User' };
      const mockAll = vi.fn().mockResolvedValue({ results: [] });
      const mockFirst = vi.fn().mockResolvedValue({ total: 0 });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        all: mockAll,
        first: mockFirst,
      }));

      await TeamService.getAll(mockDb as any, '', 1, 10, 'all', currentUser);

      // Verify audit fields and LEFT JOINs are NOT present in query
      const calledQueries = mockDb.prepare.mock.calls.map(call => call[0]);
      const selectQuery = calledQueries.find(q => q.includes('SELECT') && q.includes('u.id'));

      expect(selectQuery).toBeDefined();
      expect(selectQuery).not.toContain('password_updated_by');
      expect(selectQuery).not.toContain('banned_by');
      expect(selectQuery).not.toContain('created_by');
      expect(selectQuery).not.toContain('updated_by');
      expect(selectQuery).not.toContain('LEFT JOIN Users');
    });
  });

  describe('getStats', () => {
    it('should return correct aggregated stats', async () => {
      const mockFirst = vi.fn().mockResolvedValue({
        totalMembers: 10,
        activeMembers: 8,
        suspendedMembers: 2,
        adminsCount: 2,
      });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const stats = await TeamService.getStats(mockDb as any, { dashboard_id: 'dash_1' } as any);
      expect(stats.totalMembers).toBe(10);
      expect(stats.activeMembers).toBe(8);
      expect(stats.suspendedMembers).toBe(2);
      expect(stats.adminsCount).toBe(2);
    });
  });

  describe('getById', () => {
    it('should return USER_NOT_FOUND if user does not exist', async () => {
      const currentUser = { id: 'admin1', role: 'Admin' };
      const mockFirst = vi.fn().mockResolvedValue(null);

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.getById(mockDb as any, 'nonexistent', currentUser);
      expect(result.error).toBe('USER_NOT_FOUND');
      expect(result.status).toBe(404);
    });

    it('should return FORBIDDEN if User tries to fetch Admin details', async () => {
      const currentUser = { id: 'user1', role: 'User' };
      const mockFirst = vi.fn().mockResolvedValue({ id: 'admin1', role: 'Admin' });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.getById(mockDb as any, 'admin1', currentUser);
      expect(result.error).toBe('FORBIDDEN');
      expect(result.status).toBe(403);
    });

    it('should return user details successfully if allowed', async () => {
      const currentUser = { id: 'admin1', role: 'Admin' };
      const mockFirst = vi.fn().mockResolvedValue({
        id: 'user1',
        role: 'User',
        permissions: '{"can_write": true}',
      });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.getById(mockDb as any, 'user1', currentUser);
      expect(result.error).toBeUndefined();
      expect(result.member).toBeDefined();
      expect(result.member!.permissions).toEqual({ can_write: true });
    });
  });

  describe('inviteMember', () => {
    it('should reject a regular User trying to invite', async () => {
      const currentRequester = { id: 'user1', profile_id: 'prof1', dashboard_id: 'dash1', role: 'User' };
      const body = { role: 'User' as const, email: 'someone@test.com' };

      const result = await TeamService.inviteMember(mockDb as any, body, currentRequester);

      expect(result.error).toBe('FORBIDDEN');
      expect(result.status).toBe(403);
    });

    it('should reject an Admin trying to invite an Admin account', async () => {
      const currentRequester = { id: 'admin1', profile_id: 'prof1', dashboard_id: 'dash1', role: 'Admin' };
      const body = { role: 'Admin' as const, email: 'admin2@test.com' };

      const result = await TeamService.inviteMember(mockDb as any, body, currentRequester);

      expect(result.error).toBe('CANNOT_INVITE_ADMIN');
      expect(result.status).toBe(403);
    });

    it('should reject invitation if user is already a member', async () => {
      const currentRequester = { id: 'owner1', profile_id: 'prof1', dashboard_id: 'dash1', role: 'Owner' };
      const body = { role: 'User' as const, email: 'existing@test.com' };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'existing_prof' });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.inviteMember(mockDb as any, body, currentRequester);
      expect(result.error).toBe('ALREADY_MEMBER');
      expect(result.status).toBe(400);
    });

    it('should allow Owner to invite an Admin', async () => {
      const currentRequester = { id: 'owner1', profile_id: 'prof1', dashboard_id: 'dash1', role: 'Owner' };
      const body = { role: 'Admin' as const, email: 'newadmin@test.com' };

      const mockFirst = vi.fn().mockResolvedValue(null);
      const mockRun = vi.fn().mockResolvedValue({ success: true });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
        run: mockRun,
      }));

      const result = await TeamService.inviteMember(mockDb as any, body, currentRequester);
      expect(result.error).toBeUndefined();
      expect(result.token).toBeDefined();
      expect(result.role).toBe('Admin');
    });
  });

  describe('update', () => {
    it('should reject User trying to modify Admin account', async () => {
      const currentRequester = { id: 'user1', role: 'User' };
      const body = { full_name: 'Updated Name' };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'admin1', role: 'Admin' });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.update(mockDb as any, mockKV as any, 'admin1', body, currentRequester);
      expect(result.error).toBe('CANNOT_MODIFY_ADMIN');
      expect(result.status).toBe(403);
    });

    it('should reject User trying to update their own account via TeamService', async () => {
      const currentRequester = { id: 'user1', role: 'User' };
      const body = { full_name: 'Updated Name' };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'user1', role: 'User' });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.update(mockDb as any, mockKV as any, 'user1', body, currentRequester);
      expect(result.error).toBe('CANNOT_MODIFY_SELF');
      expect(result.status).toBe(403);
    });

    it('should reject User trying to promote someone to Admin', async () => {
      const currentRequester = { id: 'user1', role: 'User' };
      const body = { role: 'Admin' };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'user2', role: 'User' });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.update(mockDb as any, mockKV as any, 'user2', body, currentRequester);
      expect(result.error).toBe('CANNOT_PROMOTE_TO_ADMIN');
      expect(result.status).toBe(403);
    });

    it('should reject demoting the last Admin', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };
      const body = { role: 'User' };

      // Target admin
      const mockFirst = vi.fn()
        .mockResolvedValueOnce({ id: 'admin2', role: 'Admin' }) // target user fetch
        .mockResolvedValueOnce({ count: 1 }); // hasMultipleAdmins check

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.update(mockDb as any, mockKV as any, 'admin2', body, currentRequester);
      expect(result.error).toBe('LAST_ADMIN');
      expect(result.status).toBe(400);
    });

    it('should successfully update and invalidate KV sessions', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };
      const body = { full_name: 'Updated User', permissions: { can_edit: true } };

      const mockRun = vi.fn().mockResolvedValue({ success: true });

      mockDb.prepare.mockImplementation((query) => {
        return {
          bind: vi.fn().mockReturnThis(),
          run: mockRun,
          first: vi.fn().mockImplementation(async () => {
            if (query.includes('email, role, is_banned, permissions')) {
              return { email: 'user2@test.com', role: 'User', is_banned: 0, permissions: '{"can_edit": true}' };
            }
            return { id: 'user2', role: 'User' }; // target user fetch
          })
        };
      });

      mockKV.list.mockResolvedValue({
        keys: [{ name: 'session:user2:s1' }],
        list_complete: true,
      });
      mockKV.get.mockResolvedValue(JSON.stringify({ expires_at: new Date(Date.now() + 60000).toISOString() }));

      const result = await TeamService.update(mockDb as any, mockKV as any, 'user2', body, currentRequester);
      expect(result.success).toBe(true);
      expect(mockKV.put).toHaveBeenCalled();
    });
  });

  describe('toggleStatus', () => {
    it('should reject banning oneself', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };
      const body = { is_banned: true };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'admin1', role: 'Admin' });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.toggleStatus(mockDb as any, mockKV as any, 'admin1', body, currentRequester);
      expect(result.error).toBe('CANNOT_MODIFY_SELF');
      expect(result.status).toBe(403);
    });

    it('should reject banning the last admin', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };
      const body = { is_banned: true };

      const mockFirst = vi.fn()
        .mockResolvedValueOnce({ id: 'admin2', role: 'Admin' })
        .mockResolvedValueOnce({ count: 1 });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.toggleStatus(mockDb as any, mockKV as any, 'admin2', body, currentRequester);
      expect(result.error).toBe('LAST_ADMIN');
      expect(result.status).toBe(400);
    });

    it('should successfully ban a user and delete all active sessions', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };
      const body = { is_banned: true };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'user2', role: 'User' });
      const mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
        run: mockRun,
      }));

      mockKV.list.mockResolvedValue({
        keys: [{ name: 'session:user2:s1' }],
        list_complete: true,
      });

      const result = await TeamService.toggleStatus(mockDb as any, mockKV as any, 'user2', body, currentRequester);
      expect(result.success).toBe(true);
      expect(mockKV.delete).toHaveBeenCalledWith('session:user2:s1');
    });
  });

  describe('delete', () => {
    it('should reject deleting oneself', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };

      const mockFirst = vi.fn().mockResolvedValue({ id: 'admin1', role: 'Admin' });
      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.delete(mockDb as any, mockKV as any, 'admin1', currentRequester);
      expect(result.error).toBe('CANNOT_MODIFY_SELF');
      expect(result.status).toBe(403);
    });

    it('should reject deletion if user is linked to article comments (operations history)', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };

      const mockFirst = vi.fn()
        .mockResolvedValueOnce({ id: 'user2', role: 'User' }) // target user fetch
        .mockResolvedValueOnce({ total_references: 5 }); // has references check

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
      }));

      const result = await TeamService.delete(mockDb as any, mockKV as any, 'user2', currentRequester);
      expect(result.error).toBe('USER_HAS_OPERATIONS');
      expect(result.status).toBe(400);
    });

    it('should successfully delete user if there are no linked operations', async () => {
      const currentRequester = { id: 'admin1', role: 'Admin' };

      const mockFirst = vi.fn()
        .mockResolvedValueOnce({ id: 'user2', role: 'User' }) // target user fetch
        .mockResolvedValueOnce({ total_references: 0 }); // has references check (none)
      const mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });

      mockDb.prepare.mockImplementation(() => ({
        bind: vi.fn().mockReturnThis(),
        first: mockFirst,
        run: mockRun,
      }));

      mockKV.list.mockResolvedValue({ keys: [] });

      const result = await TeamService.delete(mockDb as any, mockKV as any, 'user2', currentRequester);
      expect(result.success).toBe(true);
    });
  });
});
