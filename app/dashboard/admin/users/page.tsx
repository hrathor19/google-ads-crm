'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { DataTable, type Column } from '@/components/data/data-table';
import { ErrorState, TableSkeleton } from '@/components/data/states';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { formatRelative } from '@/lib/format';

type UserRow = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  mustChangePassword: boolean;
  allAccounts: boolean;
  lastLoginAt: string | null;
  roleId: string;
  role: { id: string; name: string; isSuperAdmin: boolean };
  accountIds: number[];
};

type Role = { id: string; name: string; isSuperAdmin: boolean };

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can, user: me } = usePermissions();

  const users = useApi<{ users: UserRow[] }>(['users'], '/api/admin/users');
  const roles = useApi<{ roles: Role[] }>(['roles'], '/api/admin/roles');

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ email: '', name: '', roleId: '', password: '' });
  const [newPassword, setNewPassword] = useState('');

  if (users.error) return <ErrorState error={users.error} onRetry={() => users.refetch()} />;

  const canManage = can('USERS', 'MANAGE');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  async function createUser() {
    setBusy(true);
    try {
      await apiSend('/api/admin/users', 'POST', form);
      toast({
        title: 'User created',
        description: 'They will be asked to change the password on first sign-in.',
      });
      setCreating(false);
      setForm({ email: '', name: '', roleId: '', password: '' });
      invalidate();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not create the user',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, successTitle: string) {
    setBusy(true);
    try {
      await apiSend(`/api/admin/users/${id}`, 'PATCH', body);
      toast({ title: successTitle });
      setEditing(null);
      setResetting(null);
      setNewPassword('');
      invalidate();
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not save',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  const columns: Array<Column<UserRow>> = [
    {
      key: 'name',
      header: 'User',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-xs text-muted-foreground">{r.email}</p>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (r) => (
        <Badge variant={r.role.isSuperAdmin ? 'default' : 'secondary'} className="font-normal">
          {r.role.name}
        </Badge>
      ),
      sortValue: (r) => r.role.name,
    },
    {
      key: 'scope',
      header: 'Account scope',
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.allAccounts ? 'All accounts' : `${r.accountIds.length} account(s)`}
        </span>
      ),
      sortValue: (r) => (r.allAccounts ? 0 : r.accountIds.length),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <Badge
            variant="outline"
            className={
              r.isActive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'text-muted-foreground'
            }
          >
            {r.isActive ? 'Active' : 'Inactive'}
          </Badge>
          {r.mustChangePassword && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Password reset pending
            </Badge>
          )}
        </div>
      ),
      sortValue: (r) => (r.isActive ? 1 : 0),
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      align: 'right',
      cell: (r) => <span className="text-sm">{formatRelative(r.lastLoginAt)}</span>,
      sortValue: (r) => r.lastLoginAt,
      hideOnMobile: true,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (r: UserRow) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setEditing(r)}
                  aria-label={`Edit ${r.name}`}
                >
                  <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => setResetting(r)}
                  aria-label={`Reset password for ${r.name}`}
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ),
            align: 'right' as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Create users, assign roles, activate or deactivate accounts, and reset passwords."
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New user
            </Button>
          )
        }
      />

      {users.isLoading || !users.data ? (
        <TableSkeleton rows={6} columns={5} />
      ) : (
        <DataTable
          rows={users.data.users}
          columns={columns}
          rowKey={(r) => r.id}
          searchable={(r) => `${r.name} ${r.email} ${r.role.name}`}
          searchPlaceholder="Search by name, email or role…"
          caption="Users and their roles"
        />
      )}

      {/* Create */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              They will be asked to replace this password the first time they sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="newName">Name</Label>
              <Input
                id="newName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newEmail">Email</Label>
              <Input
                id="newEmail"
                type="email"
                autoCapitalize="none"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newRole">Role</Label>
              <Select
                value={form.roleId}
                onValueChange={(v) => setForm({ ...form, roleId: v })}
              >
                <SelectTrigger id="newRole">
                  <SelectValue placeholder="Pick a role" />
                </SelectTrigger>
                <SelectContent>
                  {(roles.data?.roles ?? [])
                    .filter((r) => me.isSuperAdmin || !r.isSuperAdmin)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPass">Temporary password</Label>
              <Input
                id="newPass"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 10 characters, mixed case and a number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !form.email || !form.name || !form.roleId || !form.password}
              onClick={createUser}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="editRole">Role</Label>
                <Select
                  value={editing.roleId}
                  onValueChange={(v) => setEditing({ ...editing, roleId: v })}
                  disabled={editing.id === me.id}
                >
                  <SelectTrigger id="editRole">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(roles.data?.roles ?? [])
                      .filter((r) => me.isSuperAdmin || !r.isSuperAdmin)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {editing.id === me.id && (
                  <p className="text-xs text-muted-foreground">
                    You cannot change your own role.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="activeSwitch" className="text-sm">
                    Active
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    An inactive user is signed out within five minutes.
                  </p>
                </div>
                <Switch
                  id="activeSwitch"
                  checked={editing.isActive}
                  disabled={editing.id === me.id}
                  onCheckedChange={(v) => setEditing({ ...editing, isActive: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                editing &&
                patch(
                  editing.id,
                  { roleId: editing.roleId, isActive: editing.isActive },
                  'User updated'
                )
              }
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password */}
      <Dialog open={resetting !== null} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.name}</DialogTitle>
            <DialogDescription>
              They will be forced to choose a new one at their next sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="resetPass">New temporary password</Label>
            <Input
              id="resetPass"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 10 characters, mixed case and a number"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || newPassword.length < 10}
              onClick={() =>
                resetting &&
                patch(resetting.id, { resetPassword: newPassword }, 'Password reset')
              }
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
