import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Loader2, Search, Mail, Filter, Trash2, UserPlus, Shield, CheckSquare, RotateCw } from 'lucide-react';
import { format } from 'date-fns';
import OnboardingTour from '../components/onboarding/OnboardingTour';
import { InfoTooltip } from '../components/ui/tooltip-wrapper';

export default function ManageUsers() {
  const { user, logout } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('lead');
  const [inviting, setInviting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(null);
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;

    if (user.role !== 'admin' && user.is_user_admin !== true) {
      window.location.href = '/';
    }

    // Show onboarding for first-time admins or user admins
    if ((user.role === 'admin' || user.is_user_admin === true) && !user.has_completed_onboarding) {
      setShowOnboarding(true);
    }
  }, [user]);

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ['managedUsers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);

      const users = data || [];

      // Filter to show only users invited by this user admin (or all if main admin)
      if (user?.role === 'admin') {
        return users;
      }
      return users.filter(u => u.invited_by === user?.email);
    },
    enabled: !!user
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }) => {
      if (newRole === 'user_admin') {
        // Set user admin flag
        const data = await invokeFunction('updateUserAdmin', {
          user_id: userId,
          is_user_admin: true
        });
        return data;
      } else if (newRole === 'remove_user_admin') {
        // Remove user admin flag and set assigned role to none
        const data = await invokeFunction('updateUserAdmin', {
          user_id: userId,
          is_user_admin: false
        });
        return data;
      } else {
        await supabase.from('profiles').update({ assigned_role: newRole }).eq('id', userId);
        return { success: true };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedUsers'] });
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId) => {
      const data = await invokeFunction('deleteUser', { user_id: userId });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedUsers'] });
    }
  });

  const updateSystemRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }) => {
      const data = await invokeFunction('updateUserRole', {
        user_id: userId,
        new_role: newRole
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedUsers'] });
    }
  });

  const handleInviteUser = async (e) => {
    e.preventDefault();
    setInviting(true);
    try {
      if (inviteRole === 'user_admin') {
        await invokeFunction('inviteUserAdmin', {
          email: inviteEmail,
          full_name: inviteName
        });
      } else {
        await invokeFunction('inviteUserFromFollowUpBoss', {
          email: inviteEmail,
          name: inviteName,
          assigned_role: inviteRole
        });
      }

      setInviteEmail('');
      setInviteName('');
      setInviteRole('lead');
      queryClient.invalidateQueries({ queryKey: ['managedUsers'] });
      alert('Invitation sent successfully!');
    } catch (error) {
      alert('Failed to send invitation: ' + error.message);
    } finally {
      setInviting(false);
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!confirm(`Are you sure you want to delete ${userName}? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteUserMutation.mutateAsync(userId);
      alert('User deleted successfully');
    } catch (error) {
      alert('Failed to delete user: ' + error.message);
    }
  };

  const filteredUsers = allUsers.filter(u => {
    const matchesSearch = u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         u.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.assigned_role === roleFilter;
    const matchesStatus = statusFilter === 'all' ||
                         (statusFilter === 'accepted' && u.has_logged_in) ||
                         (statusFilter === 'invited' && !u.has_logged_in);
    const matchesUserStatus = userStatusFilter === 'all' || u.status === userStatusFilter;
    return matchesSearch && matchesRole && matchesStatus && matchesUserStatus;
  });

  const roleColors = {
    lead: 'bg-blue-100 text-blue-800',
    client: 'bg-green-100 text-green-800',
    partner: 'bg-purple-100 text-purple-800',
    none: 'bg-slate-100 text-slate-600'
  };

  const roleCounts = {
    all: allUsers.length,
    lead: allUsers.filter(u => u.assigned_role === 'lead').length,
    client: allUsers.filter(u => u.assigned_role === 'client').length,
    partner: allUsers.filter(u => u.assigned_role === 'partner').length,
    none: allUsers.filter(u => u.assigned_role === 'none' || !u.assigned_role).length
  };

  const statusCounts = {
    all: allUsers.length,
    accepted: allUsers.filter(u => u.has_logged_in).length,
    invited: allUsers.filter(u => !u.has_logged_in).length
  };

  const userStatusCounts = {
    all: allUsers.length,
    active: allUsers.filter(u => u.status === 'active').length,
    dormant: allUsers.filter(u => u.status === 'dormant').length,
    invited: allUsers.filter(u => u.status === 'invited').length
  };

  const onboardingSteps = [
    {
      target: '[data-tour="invite-form"]',
      title: 'Invite New Users',
      content: (
        <div className="space-y-2">
          <p>Start by inviting users to your platform. Enter their name, email, and assign them a role.</p>
          <p className="text-sm text-slate-600">• <strong>Lead</strong>: Prospective buyers<br/>
          • <strong>Client</strong>: Active buyers<br/>
          • <strong>Partner</strong>: Business partners<br/>
          • <strong>User Admin</strong>: Can manage users (admin only)</p>
        </div>
      )
    },
    {
      target: '[data-tour="filters"]',
      title: 'Filter Users',
      content: 'Use these filters to search for specific users by name, email, role, or invitation status. This helps you manage large user bases efficiently.'
    },
    {
      target: '[data-tour="user-table"]',
      title: 'Manage User Roles',
      content: (
        <div className="space-y-2">
          <p>Click on any dropdown to change user roles instantly. You can:</p>
          <p className="text-sm text-slate-600">• Update assigned roles for better organization<br/>
          • Change system roles (admins only)<br/>
          • Track invitation status<br/>
          • Delete users when needed</p>
        </div>
      )
    },
    {
      target: '[data-tour="stats"]',
      title: 'User Statistics',
      content: 'These cards show you quick stats about your users - total count, role distribution, and invitation status. Perfect for at-a-glance insights.'
    }
  ];

  const handleCompleteOnboarding = async () => {
    try {
      await supabase.from('profiles').update({ has_completed_onboarding: true }).eq('id', user.id);
      setShowOnboarding(false);
    } catch (error) {
      console.error('Failed to update onboarding status:', error);
      setShowOnboarding(false);
    }
  };

  const handleSkipOnboarding = async () => {
    try {
      await supabase.from('profiles').update({ has_completed_onboarding: true }).eq('id', user.id);
      setShowOnboarding(false);
    } catch (error) {
      console.error('Failed to update onboarding status:', error);
      setShowOnboarding(false);
    }
  };

  const handleResendInvitation = async (userId) => {
    setResendingEmail(userId);
    try {
      await invokeFunction('resendInvitationEmail', { user_id: userId });
      alert('Invitation email resent successfully!');
    } catch (error) {
      alert('Failed to resend invitation: ' + error.message);
    } finally {
      setResendingEmail(null);
    }
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
      </div>
    );
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingTour
          steps={onboardingSteps}
          onComplete={handleCompleteOnboarding}
          onSkip={handleSkipOnboarding}
        />
      )}
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Manage Users</h1>
          <p className="text-slate-600">
            {user.role === 'admin' ? 'Manage all users and their roles' : 'Manage users you have invited'}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8" data-tour="stats">
          <Card className="bg-white shadow-lg border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Users</p>
                  <p className="text-2xl font-bold text-slate-900">{roleCounts.all}</p>
                </div>
                <Users className="h-8 w-8 text-slate-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-blue-100">
            <CardContent className="p-4">
              <div>
                <p className="text-sm text-slate-600">Leads</p>
                <p className="text-2xl font-bold text-blue-600">{roleCounts.lead}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-green-100">
            <CardContent className="p-4">
              <div>
                <p className="text-sm text-slate-600">Clients</p>
                <p className="text-2xl font-bold text-green-600">{roleCounts.client}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-purple-100">
            <CardContent className="p-4">
              <div>
                <p className="text-sm text-slate-600">Partners</p>
                <p className="text-2xl font-bold text-purple-600">{roleCounts.partner}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-slate-100">
            <CardContent className="p-4">
              <div>
                <p className="text-sm text-slate-600">Unassigned</p>
                <p className="text-2xl font-bold text-slate-600">{roleCounts.none}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-green-100">
            <CardContent className="p-4">
              <div>
                <p className="text-sm text-slate-600">Active</p>
                <p className="text-2xl font-bold text-green-600">{userStatusCounts.active}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-orange-100">
            <CardContent className="p-4">
              <div>
                <p className="text-sm text-slate-600">Dormant</p>
                <p className="text-2xl font-bold text-orange-600">{userStatusCounts.dormant}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invite Form */}
        <Card className="mb-6 shadow-lg border-slate-200" data-tour="invite-form">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Invite New User
              <InfoTooltip content="Send an invitation email with login credentials and assigned role to new users" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInviteUser} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    placeholder="John Doe"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="role" className="flex items-center">
                    Assigned Role
                    <InfoTooltip content="Assign a role to categorize and manage users effectively. User Admins can manage other users." />
                  </Label>
                  <Select
                    value={inviteRole}
                    onValueChange={setInviteRole}
                  >
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">Lead</SelectItem>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      {user?.role === 'admin' && (
                        <SelectItem value="user_admin">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-amber-600" />
                            User Admin
                          </div>
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={inviting}
                className="bg-slate-800 hover:bg-slate-700"
              >
                {inviting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Send Invitation
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card className="mb-6 shadow-lg border-slate-200" data-tour="filters">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles ({roleCounts.all})</SelectItem>
                    <SelectItem value="lead">Leads ({roleCounts.lead})</SelectItem>
                    <SelectItem value="client">Clients ({roleCounts.client})</SelectItem>
                    <SelectItem value="partner">Partners ({roleCounts.partner})</SelectItem>
                    <SelectItem value="none">Unassigned ({roleCounts.none})</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                   <SelectTrigger className="w-48">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="all">All Status ({statusCounts.all})</SelectItem>
                     <SelectItem value="accepted">Accepted ({statusCounts.accepted})</SelectItem>
                     <SelectItem value="invited">Invited Only ({statusCounts.invited})</SelectItem>
                   </SelectContent>
                 </Select>
                 <Select value={userStatusFilter} onValueChange={setUserStatusFilter}>
                   <SelectTrigger className="w-48">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="all">All User Status ({userStatusCounts.all})</SelectItem>
                     <SelectItem value="active">Active ({userStatusCounts.active})</SelectItem>
                     <SelectItem value="dormant">Dormant ({userStatusCounts.dormant})</SelectItem>
                     <SelectItem value="invited">Invited ({userStatusCounts.invited})</SelectItem>
                   </SelectContent>
                 </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card className="shadow-lg border-slate-200" data-tour="user-table">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users ({filteredUsers.length})
              <InfoTooltip content="View and manage all users. Update roles, track invitation status, and delete users as needed." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">
                  {searchTerm || roleFilter !== 'all'
                    ? 'No users match your filters'
                    : 'No users found'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>
                         Invitation Status
                         <InfoTooltip content="Invited users haven't logged in yet. Accepted users have completed registration." side="right" />
                       </TableHead>
                       <TableHead>
                         User Status
                         <InfoTooltip content="Active: Currently engaged. Dormant: No activity for 30+ days. Invited: Never logged in." side="right" />
                       </TableHead>
                       <TableHead>
                         System Role
                         <InfoTooltip content="Admin: Full access. User: Standard access. Only admins can change this." side="right" />
                       </TableHead>
                      <TableHead>
                        Assigned Role
                        <InfoTooltip content="Categorize users as Leads, Clients, Partners, or User Admins for better management." side="right" />
                      </TableHead>
                      <TableHead>Invited By</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {u.full_name || 'Unknown'}
                            {u.is_user_admin && (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
                                <Shield className="h-3 w-3 mr-1" />
                                User Admin
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-slate-400" />
                            {u.email}
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.has_logged_in ? (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckSquare className="h-3 w-3 mr-1" />
                              Accepted
                            </Badge>
                          ) : (
                            <button
                              onClick={() => handleResendInvitation(u.id)}
                              disabled={resendingEmail === u.id}
                              className="inline-flex items-center"
                            >
                              <Badge className="bg-amber-100 text-amber-800 cursor-pointer hover:bg-amber-200 transition-colors">
                                {resendingEmail === u.id ? (
                                  <>
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    Sending...
                                  </>
                                ) : (
                                  <>
                                    <Mail className="h-3 w-3 mr-1" />
                                    Invited
                                  </>
                                )}
                              </Badge>
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.status === 'active' && (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckSquare className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          )}
                          {u.status === 'dormant' && (
                            <Badge className="bg-orange-100 text-orange-800">
                              <Mail className="h-3 w-3 mr-1" />
                              Dormant
                            </Badge>
                          )}
                          {u.status === 'invited' && (
                            <Badge className="bg-slate-100 text-slate-700">
                              <Mail className="h-3 w-3 mr-1" />
                              Invited
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user?.role === 'admin' ? (
                            <Select
                              value={u.role}
                              onValueChange={(newRole) =>
                                updateSystemRoleMutation.mutate({ userId: u.id, newRole })
                              }
                              disabled={u.email === user.email}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                              <Shield className="h-3 w-3 mr-1" />
                              {u.role}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.is_user_admin ? 'user_admin' : (u.assigned_role || 'none')}
                            onValueChange={(newRole) =>
                              updateRoleMutation.mutate({ userId: u.id, newRole })
                            }
                            disabled={user.role !== 'admin' && u.invited_by !== user.email}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              <SelectItem value="lead">Lead</SelectItem>
                              <SelectItem value="client">Client</SelectItem>
                              <SelectItem value="partner">Partner</SelectItem>
                              {user?.role === 'admin' && (
                                <>
                                  <SelectItem value="user_admin">
                                    <div className="flex items-center gap-2">
                                      <Shield className="h-4 w-4 text-amber-600" />
                                      User Admin
                                    </div>
                                  </SelectItem>
                                  {u.is_user_admin && (
                                    <SelectItem value="remove_user_admin">
                                      Remove User Admin
                                    </SelectItem>
                                  )}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {u.invited_by || 'System'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {format(new Date(u.created_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteUser(u.id, u.full_name || u.email)}
                            disabled={
                              u.email === user.email ||
                              (user.role !== 'admin' && u.invited_by !== user.email)
                            }
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  );
}
