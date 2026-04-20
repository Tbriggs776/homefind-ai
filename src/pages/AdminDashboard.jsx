import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Users, TrendingDown, Eye, Heart, Loader2,
  AlertCircle, CheckCircle, Clock, Sparkles, Link as LinkIcon, RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import FollowUpBossContacts from '../components/admin/FollowUpBossContacts';
import InviteUserAdmin from '../components/admin/InviteUserAdmin';
import FollowUpBossFieldMapping from '../components/admin/FollowUpBossFieldMapping';
import FollowUpBossSyncHistory from '../components/admin/FollowUpBossSyncHistory';
import AnalyticsDashboard from '../components/admin/AnalyticsDashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '../components/ui/tooltip-wrapper';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [generatingSummaryFor, setGeneratingSummaryFor] = useState(null); // holds the userId currently being generated, or null
  const [viewingSummaryUser, setViewingSummaryUser] = useState(null); // holds the user object whose summary is being viewed in the dialog, or null
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [syncResults, setSyncResults] = useState(null);

  useEffect(() => {
    if (!user) return;

    if (user.role !== 'admin' && user.is_user_admin !== true) {
      window.location.href = '/';
    }
  }, [user]);

  // Fetch engagement alerts
  const { data: alerts = [], isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ['engagementAlerts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('engagement_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      return data || [];
    },
  });

  // Fetch all users
  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      return data || [];
    },
    enabled: !!(user?.role === 'admin' || user?.is_user_admin === true)
  });

  // Fetch all property views
  const { data: allViews = [] } = useQuery({
    queryKey: ['allPropertyViews'],
    queryFn: async () => {
      const { data } = await supabase
        .from('property_views')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);
      return data || [];
    },
  });

  const generateAISummary = async (userId) => {
    setGeneratingSummaryFor(userId);
    try {
      const result = await invokeFunction('generateAISummary', { user_id: userId });
      if (result?.error) {
        console.error('generateAISummary error:', result.error);
        return null;
      }
      // Refresh the users list so the new ai_summary shows up inline
      await queryClient.invalidateQueries({ queryKey: ['allUsers'] });
      return result.summary || null;
    } catch (error) {
      console.error('generateAISummary threw:', error);
      return null;
    } finally {
      setGeneratingSummaryFor(null);
    }
  };

  const updateAlertStatus = async (alertId, status) => {
    await supabase.from('engagement_alerts').update({ status }).eq('id', alertId);
    refetchAlerts();
  };

  const syncToFollowUpBoss = async (alertId) => {
    try {
      await invokeFunction('syncToFollowUpBoss', { alert_id: alertId });
      refetchAlerts();
      alert('Successfully synced to Follow Up Boss!');
    } catch (error) {
      alert('Failed to sync: ' + error.message);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      const data = await invokeFunction('testSparkApiConnection', {});
      setTestResults(data);
    } catch (error) {
      setTestResults({ error: error.message });
    } finally {
      setTesting(false);
    }
  };

  const syncListings = async () => {
    setSyncing(true);
    setSyncResults(null);
    try {
      const data = await invokeFunction('syncSparkApiListings', {});
      setSyncResults(data);
    } catch (error) {
      setSyncResults({ error: error.message });
    } finally {
      setSyncing(false);
    }
  };

  const alertStatusConfig = {
    new: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    acknowledged: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
    action_taken: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
    dismissed: { icon: CheckCircle, color: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200' }
  };

  // Calculate engagement stats
  const activeUsers = allUsers.filter(u => {
    const userViews = allViews.filter(v => v.user_id === u.id);
    return userViews.length > 0;
  }).length;

  const newAlerts = alerts.filter(a => a.status === 'new').length;

  if (!user) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="crandell-container">
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">Admin Dashboard</h1>
            <InfoTooltip content="Track user activity, manage engagement alerts, and integrate with Follow Up Boss CRM" />
          </div>
          <p className="text-slate-600">Monitor user engagement and manage follow-ups</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="bg-white shadow-lg border-slate-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Total Users</p>
                  <p className="text-3xl font-bold text-slate-900">{allUsers.length}</p>
                </div>
                <Users className="h-10 w-10 text-slate-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-slate-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1 flex items-center">
                    Active Users
                    <InfoTooltip content="Users who have viewed at least one property" />
                  </p>
                  <p className="text-3xl font-bold text-slate-900">{activeUsers}</p>
                </div>
                <Eye className="h-10 w-10 text-green-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-slate-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1 flex items-center">
                    New Alerts
                    <InfoTooltip content="Engagement drop alerts that need attention" />
                  </p>
                  <p className="text-3xl font-bold text-red-600">{newAlerts}</p>
                </div>
                <AlertCircle className="h-10 w-10 text-red-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-lg border-slate-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Total Views</p>
                  <p className="text-3xl font-bold text-slate-900">{allViews.length}</p>
                </div>
                <TrendingDown className="h-10 w-10 text-amber-300" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="analytics" className="space-y-6">
          <TabsList className="bg-white border border-slate-200 flex-wrap h-auto gap-1">
            <TabsTrigger value="analytics" className="data-[state=active]:bg-slate-100">
              Analytics
            </TabsTrigger>
            <TabsTrigger value="alerts" className="data-[state=active]:bg-slate-100">
              Engagement Alerts ({newAlerts})
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-slate-100">
              User Activity
            </TabsTrigger>
            <TabsTrigger value="crm" className="data-[state=active]:bg-slate-100">
              CRM Integration
            </TabsTrigger>
            {user?.role === 'admin' && (
              <TabsTrigger value="idx-setup" className="data-[state=active]:bg-slate-100">
                MLS Setup
              </TabsTrigger>
            )}
          </TabsList>

          {/* Analytics Tab */}
          <TabsContent value="analytics">
            <AnalyticsDashboard
              allUsers={allUsers}
              allViews={allViews}
              alerts={alerts}
            />
          </TabsContent>

          {/* Alerts Tab */}
          <TabsContent value="alerts">
          <Card className="shadow-lg border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Engagement Drop Alerts
                <InfoTooltip content="Automated alerts when user activity drops by 50% or more. Take action to re-engage users." />
              </CardTitle>
            </CardHeader>
              <CardContent>
                {alertsLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <p className="text-slate-600">No alerts at this time. All users are engaged!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {alerts.map(alert => {
                      const config = alertStatusConfig[alert.status];
                      const Icon = config.icon;

                      return (
                        <Card key={alert.id} className={`border-2 ${config.border} ${config.bg}`}>
                          <CardContent className="p-5">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-start gap-3">
                                <Icon className={`h-5 w-5 mt-1 ${config.color}`} />
                                <div>
                                  <h3 className="font-semibold text-slate-900">
                                    {alert.user_name || alert.user_email}
                                  </h3>
                                  <p className="text-sm text-slate-600">{alert.user_email}</p>
                                </div>
                              </div>
                              <Badge className={`${config.bg} ${config.color} border-0`}>
                                {alert.status.replace('_', ' ')}
                              </Badge>
                            </div>

                            <div className="ml-8 space-y-2">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="text-slate-600">Engagement Drop:</span>
                                  <span className="ml-2 font-semibold text-red-600">
                                    {alert.drop_percentage}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-slate-600">Last Activity:</span>
                                  <span className="ml-2 font-semibold">
                                    {alert.last_activity_date
                                      ? format(new Date(alert.last_activity_date), 'MMM d, yyyy')
                                      : 'N/A'}
                                  </span>
                                </div>
                              </div>

                              {alert.ai_summary && (
                                <div className="bg-white/50 rounded-lg p-3 text-sm text-slate-700">
                                  <div className="flex items-start gap-2">
                                    <Sparkles className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                    <p>{alert.ai_summary}</p>
                                  </div>
                                </div>
                              )}

                              {alert.recommended_action && (
                                <div className="bg-blue-50 rounded-lg p-3 text-sm">
                                  <p className="font-medium text-blue-900 mb-1">Recommended Action:</p>
                                  <p className="text-blue-800">{alert.recommended_action}</p>
                                </div>
                              )}

                              <div className="flex gap-2 pt-2 flex-wrap">
                                {alert.status === 'new' && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => updateAlertStatus(alert.id, 'acknowledged')}
                                    >
                                      Acknowledge
                                    </Button>
                                    <Button
                                     size="sm"
                                     className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1"
                                     onClick={() => syncToFollowUpBoss(alert.id)}
                                    >
                                     Sync to Follow Up Boss
                                     <InfoTooltip content="Create a task in Follow Up Boss CRM for this alert" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="bg-slate-800 hover:bg-slate-700"
                                      onClick={() => updateAlertStatus(alert.id, 'action_taken')}
                                    >
                                      Mark as Handled
                                    </Button>
                                  </>
                                )}
                                {alert.status === 'acknowledged' && (
                                  <Button
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700"
                                    onClick={() => updateAlertStatus(alert.id, 'action_taken')}
                                  >
                                    Mark Complete
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateAlertStatus(alert.id, 'dismissed')}
                                  className="text-slate-600"
                                >
                                  Dismiss
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users">
          <Card className="shadow-lg border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                User Engagement Overview
                <InfoTooltip content="Track each user's property views, favorites, and activity. Generate AI summaries for deeper insights." />
              </CardTitle>
            </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Views</TableHead>
                      <TableHead>Favorites</TableHead>
                      <TableHead>Last Active</TableHead>
                      <TableHead>AI Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allUsers.map(u => {
                      const userViews = allViews.filter(v => v.user_id === u.id);
                      const favorites = userViews.filter(v => v.interaction_type === 'favorite');
                      const lastView = userViews[0];

                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-slate-900">{u.full_name || 'Unknown'}</p>
                              <p className="text-sm text-slate-500">{u.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Eye className="h-4 w-4 text-slate-400" />
                              <span className="font-medium">{userViews.length}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Heart className="h-4 w-4 text-red-400" />
                              <span className="font-medium">{favorites.length}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {lastView ? format(new Date(lastView.created_at), 'MMM d, yyyy') : 'Never'}
                          </TableCell>
                          <TableCell>
                            {u.ai_summary ? (
                              <div className="flex items-start gap-2 max-w-sm">
                                <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-1" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-slate-700 line-clamp-2">
                                    {u.ai_summary}
                                  </p>
                                  <div className="flex items-center gap-3 mt-1">
                                    <button
                                      type="button"
                                      onClick={() => setViewingSummaryUser(u)}
                                      className="text-xs font-medium text-primary hover:underline"
                                    >
                                      View full
                                    </button>
                                    {u.ai_summary_generated_at && (
                                      <span className="text-xs text-slate-400">
                                        {format(new Date(u.ai_summary_generated_at), 'MMM d, yyyy')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => generateAISummary(u.id)}
                                disabled={generatingSummaryFor === u.id || userViews.length === 0}
                                className="flex items-center gap-1"
                              >
                                {generatingSummaryFor === u.id ? (
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3 mr-1" />
                                )}
                                {generatingSummaryFor === u.id ? 'Generating...' : 'Generate'}
                                {userViews.length > 0 && generatingSummaryFor !== u.id && (
                                  <InfoTooltip content="AI analyzes user behavior and preferences to provide actionable insights" />
                                )}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          {/* CRM Integration Tab */}
          <TabsContent value="crm" className="space-y-6">
            {(user?.role === 'admin' || user?.is_user_admin === true) && <InviteUserAdmin />}
            <FollowUpBossFieldMapping />
            <FollowUpBossSyncHistory />
            <FollowUpBossContacts />
          </TabsContent>

          {/* MLS Setup Tab (Admin Only) */}
          {user?.role === 'admin' && (
            <TabsContent value="idx-setup" className="space-y-6">
              <Card className="shadow-lg border-slate-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Spark API Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      Spark API credentials are configured and ready
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              <Card className="shadow-lg border-slate-200">
                <CardHeader>
                  <CardTitle>Spark API Setup</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      <strong>Spark API</strong> provides direct access to Flexmls MLS listings with real-time updates.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-3 text-sm text-slate-700">
                    <p className="font-semibold">About Spark API:</p>
                    <ul className="list-disc ml-5 space-y-2">
                      <li>Access to active MLS listings with detailed property information</li>
                      <li>Real-time updates and photo galleries</li>
                      <li>Support for custom filters and search parameters</li>
                      <li>Non-expiring access tokens for reliable integration</li>
                    </ul>

                    <div className="mt-4 p-4 bg-slate-50 rounded-lg">
                      <p className="font-semibold mb-2">Already Configured:</p>
                      <ul className="space-y-1 text-xs">
                        <li>✓ API Key (OAuth Key)</li>
                        <li>✓ Access Token</li>
                        <li>✓ Ready to sync listings</li>
                      </ul>
                    </div>

                    <Alert className="bg-amber-50 border-amber-200 mt-4">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-amber-800">
                        <strong>Note:</strong> Visit <a href="https://sparkplatform.com/appstore/admin" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Spark Platform</a> to manage your API access or regenerate tokens.
                      </AlertDescription>
                    </Alert>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-lg border-slate-200">
                <CardHeader>
                  <CardTitle>Test API Connection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-600">
                    Test the connection to Spark API to verify your credentials and endpoint access.
                  </p>
                  <Button
                    onClick={testConnection}
                    disabled={testing}
                    className="bg-slate-800 hover:bg-slate-700"
                  >
                    {testing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <LinkIcon className="h-4 w-4 mr-2" />
                        Test Connection
                      </>
                    )}
                  </Button>

                  {testResults && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2 text-slate-900">Test Results:</h4>
                      <Textarea
                        value={JSON.stringify(testResults, null, 2)}
                        readOnly
                        className="h-64 font-mono text-xs bg-slate-50"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-lg border-slate-200">
                <CardHeader>
                  <CardTitle>Sync MLS Listings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      Import active MLS listings from Spark API into your database. Each run processes ~200 listings using price-bucketed pagination to scale beyond 5,000+ properties. Runs automatically every 20 minutes.
                    </AlertDescription>
                  </Alert>

                  <Button
                    onClick={syncListings}
                    disabled={syncing}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Syncing Listings...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Sync Listings Now
                      </>
                    )}
                  </Button>

                  {syncResults && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2 text-slate-900">Sync Results:</h4>
                      {syncResults.success ? (
                        <Alert className="bg-green-50 border-green-200">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <AlertDescription className="text-green-800">
                            Successfully synced {syncResults.synced} new listings and updated {syncResults.updated} existing listings.
                            {syncResults.errors > 0 && ` (${syncResults.errors} errors)`}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Alert className="bg-red-50 border-red-200">
                          <AlertCircle className="h-4 w-4 text-red-600" />
                          <AlertDescription className="text-red-800">
                            {syncResults.error || 'Failed to sync listings'}
                          </AlertDescription>
                        </Alert>
                      )}
                      <Textarea
                        value={JSON.stringify(syncResults, null, 2)}
                        readOnly
                        className="h-40 font-mono text-xs bg-slate-50 mt-3"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* View Full AI Summary dialog */}
      <Dialog open={!!viewingSummaryUser} onOpenChange={(open) => !open && setViewingSummaryUser(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Summary — {viewingSummaryUser?.full_name || viewingSummaryUser?.email}
            </DialogTitle>
            {viewingSummaryUser?.ai_summary_generated_at && (
              <DialogDescription>
                Generated {format(new Date(viewingSummaryUser.ai_summary_generated_at), "MMM d, yyyy 'at' h:mm a")}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {viewingSummaryUser?.ai_summary}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={async () => {
                if (!viewingSummaryUser) return;
                const userId = viewingSummaryUser.id;
                await generateAISummary(userId);
                // After regeneration, fetch the updated row from the freshly-invalidated cache
                // and update the dialog to show the new text without closing it.
                const fresh = queryClient
                  .getQueryData(['allUsers'])
                  ?.find((u) => u.id === userId);
                if (fresh) setViewingSummaryUser(fresh);
              }}
              disabled={generatingSummaryFor === viewingSummaryUser?.id}
              className="flex items-center gap-2"
            >
              {generatingSummaryFor === viewingSummaryUser?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {generatingSummaryFor === viewingSummaryUser?.id ? 'Regenerating...' : 'Regenerate'}
            </Button>
            <Button onClick={() => setViewingSummaryUser(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
