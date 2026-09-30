'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plus, Shield, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/data/page-header';
import { EmptyState, ErrorState } from '@/components/data/states';
import { apiSend, useApi } from '@/lib/hooks/use-api';
import { usePermissions } from '@/components/providers/permission-provider';
import { cn } from '@/lib/utils';

type Role = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuperAdmin: boolean;
  allAccounts: boolean;
  userCount: number;
  accountIds: number[];
};

type ModuleDef = {
  key: string;
  label: string;
  description: string;
  actions: string[];
};

type Response = {
  roles: Role[];
  matrix: Record<string, Record<string, boolean>>;
  modules: ModuleDef[];
  actionLabels: Record<string, string>;
};

export default function RolesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const { data, isLoading, error, refetch } = useApi<Response>(['roles'], '/api/admin/roles');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Roles & permissions" />
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </>
    );
  }

  const canManage = can('ROLES', 'MANAGE');
  const selected = data.roles.find((r) => r.id === selectedId) ?? data.roles[0]!;
  const matrix = data.matrix[selected.id] ?? {};

  async function toggle(feature: string, allowed: boolean) {
    setSaving(feature);
    // Optimistic: the switch has to feel instantaneous, and the request is a
    // single-row upsert that either succeeds or is rolled back below.
    queryClient.setQueryData<Response>(['roles'], (prev) =>
      prev
        ? {
            ...prev,
            matrix: {
              ...prev.matrix,
              [selected.id]: { ...prev.matrix[selected.id], [feature]: allowed },
            },
          }
        : prev
    );
    try {
      await apiSend(`/api/admin/roles/${selected.id}/permissions`, 'PUT', { feature, allowed });
    } catch (e) {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast({
        variant: 'destructive',
        title: 'Could not save that toggle',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setSaving(null);
    }
  }

  async function createRole() {
    setBusy(true);
    try {
      await apiSend('/api/admin/roles', 'POST', {
        name: newName,
        description: newDescription || null,
      });
      toast({ title: 'Role created', description: 'Every permission starts off.' });
      setCreating(false);
      setNewName('');
      setNewDescription('');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not create the role',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function cloneRole() {
    if (!cloning) return;
    setBusy(true);
    try {
      await apiSend(`/api/admin/roles/${cloning.id}/clone`, 'POST', { name: newName });
      toast({ title: 'Role cloned', description: 'Every toggle was copied across.' });
      setCloning(null);
      setNewName('');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not clone the role',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole() {
    if (!deleting) return;
    setBusy(true);
    try {
      await apiSend(`/api/admin/roles/${deleting.id}`, 'DELETE');
      toast({ title: 'Role deleted' });
      setDeleting(null);
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Could not delete the role',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Toggles apply immediately. Every change is written to the audit log."
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              New role
            </Button>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        {/* Role list */}
        <Card className="h-fit">
          <CardContent className="space-y-1 p-2">
            {data.roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedId(role.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                  role.id === selected.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                )}
                aria-current={role.id === selected.id ? 'true' : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{role.name}</span>
                  {role.isSuperAdmin && (
                    <Shield className="h-3 w-3 shrink-0 opacity-70" aria-label="Super Admin" />
                  )}
                </div>
                <p
                  className={cn(
                    'mt-0.5 text-xs',
                    role.id === selected.id ? 'opacity-80' : 'text-muted-foreground'
                  )}
                >
                  {role.userCount} user{role.userCount === 1 ? '' : 's'}
                  {role.isSystem && ' · default'}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Matrix */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  {selected.name}
                  {selected.isSystem && (
                    <Badge variant="secondary" className="font-normal">
                      Default role
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {selected.description ?? 'No description.'}
                </CardDescription>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCloning(selected);
                      setNewName(`${selected.name} copy`);
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Clone
                  </Button>
                  {!selected.isSystem && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={selected.userCount > 0}
                            onClick={() => setDeleting(selected)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">Delete role</span>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {selected.userCount > 0 && (
                        <TooltipContent>
                          {selected.userCount} user(s) still have this role. Move them first.
                        </TooltipContent>
                      )}
                    </Tooltip>
                  )}
                </div>
              )}
            </CardHeader>
          </Card>

          {selected.isSuperAdmin ? (
            <EmptyState
              icon={Shield}
              title="Super Admin bypasses the matrix"
              description="This role answers true to every permission check by design, so there is nothing to toggle. Create a custom role if you need a narrower set of powers."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th
                          scope="col"
                          className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          Module
                        </th>
                        {Object.entries(data.actionLabels).map(([action, label]) => (
                          <th
                            key={action}
                            scope="col"
                            className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.modules.map((mod) => (
                        <tr key={mod.key} className="border-b last:border-0">
                          <th
                            scope="row"
                            className="sticky left-0 z-10 max-w-[16rem] bg-card px-4 py-3 text-left font-normal"
                          >
                            <p className="text-sm font-medium">{mod.label}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {mod.description}
                            </p>
                          </th>
                          {Object.keys(data.actionLabels).map((action) => {
                            const supported = mod.actions.includes(action);
                            const feature = `${mod.key}:${action}`;
                            if (!supported) {
                              return (
                                <td key={action} className="px-3 py-3 text-center">
                                  <span className="text-muted-foreground/40" aria-hidden="true">
                                    —
                                  </span>
                                  <span className="sr-only">Not applicable</span>
                                </td>
                              );
                            }
                            return (
                              <td key={action} className="px-3 py-3 text-center">
                                <div className="flex items-center justify-center">
                                  {saving === feature ? (
                                    <Loader2
                                      className="h-4 w-4 animate-spin text-muted-foreground"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Switch
                                      checked={Boolean(matrix[feature])}
                                      disabled={!canManage}
                                      onCheckedChange={(v) => toggle(feature, v)}
                                      aria-label={`${data.actionLabels[action]} ${mod.label}`}
                                    />
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              The role starts with every permission off. Turn on what it needs afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="roleName">Name</Label>
              <Input
                id="roleName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Regional Manager"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roleDescription">Description</Label>
              <Textarea
                id="roleDescription"
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this role is for."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={busy || newName.trim().length < 2} onClick={createRole}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Create role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone */}
      <Dialog open={cloning !== null} onOpenChange={(o) => !o && setCloning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone “{cloning?.name}”</DialogTitle>
            <DialogDescription>
              The new role copies every permission this one effectively has.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cloneName">Name for the copy</Label>
            <Input
              id="cloneName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloning(null)}>
              Cancel
            </Button>
            <Button disabled={busy || newName.trim().length < 2} onClick={cloneRole}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Its permission rows go with it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={deleteRole}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
