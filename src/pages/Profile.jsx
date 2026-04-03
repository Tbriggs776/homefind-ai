import React, { useState } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, User, Mail, Shield, Eye, Heart, MessageCircle, Trash2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';

export default function Profile() {
  const { user, isAuthenticated, isLoadingAuth, updateProfile, logout } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Update fullName when user loads
  React.useEffect(() => {
    if (user?.full_name) setFullName(user.full_name);
  }, [user]);

  const { data: stats } = useQuery({
    queryKey: ['userStats', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const [viewsRes, savedRes, chatsRes] = await Promise.all([
        supabase.from('property_views').select('id, property_id').eq('user_id', user.id),
        supabase.from('saved_properties').select('id').eq('user_id', user.id),
        supabase.from('chat_messages').select('id').eq('user_id', user.id),
      ]);

      const views = viewsRes.data || [];
      return {
        totalViews: views.length,
        savedProperties: (savedRes.data || []).length,
        chatMessages: (chatsRes.data || []).length,
        uniqueProperties: [...new Set(views.map(v => v.property_id))].length
      };
    },
    enabled: !!user
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ full_name: fullName });
      alert('Profile updated successfully!');
    } catch {
      alert('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await invokeFunction('deleteUser', { user_id: user.id });
      alert('Account deleted successfully. You will be logged out.');
      await logout();
    } catch {
      alert('Failed to delete account. Please contact support.');
      setDeleting(false);
    }
  };

  if (isLoadingAuth) {
    return <div className="flex justify-center items-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/Login" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-8">My Profile</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="shadow-lg border-slate-200">
              <CardHeader><CardTitle>Account Information</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Enter your full name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <Input id="email" value={user?.email || ''} disabled className="bg-slate-50" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-slate-400" />
                    <Input id="role" value={user?.role || ''} disabled className="bg-slate-50 capitalize" />
                  </div>
                </div>
                <Button onClick={handleSave} disabled={saving} className="bg-slate-800 hover:bg-slate-700 select-none">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Save Changes
                </Button>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-red-200">
              <CardHeader><CardTitle className="text-red-600">Delete Account</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600">Permanently delete your account and all associated data. This action cannot be undone.</p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={deleting} className="select-none"><Trash2 className="h-4 w-4 mr-2" /> Delete My Account</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>This will permanently delete your account and remove all your data from our servers.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="select-none">Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteAccount} disabled={deleting} className="bg-red-600 hover:bg-red-700 select-none">
                        {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Delete Account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-lg border-slate-200">
              <CardHeader><CardTitle className="text-lg">Your Activity</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {stats ? (
                  <>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3"><Eye className="h-5 w-5 text-slate-600" /><span className="text-sm text-slate-700">Total Views</span></div>
                      <span className="font-bold text-slate-900">{stats.totalViews}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3"><Heart className="h-5 w-5 text-red-500" /><span className="text-sm text-slate-700">Saved Homes</span></div>
                      <span className="font-bold text-slate-900">{stats.savedProperties}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3"><MessageCircle className="h-5 w-5 text-slate-600" /><span className="text-sm text-slate-700">AI Chats</span></div>
                      <span className="font-bold text-slate-900">{stats.chatMessages}</span>
                    </div>
                  </>
                ) : (
                  <Loader2 className="h-6 w-6 animate-spin text-slate-600 mx-auto" />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
