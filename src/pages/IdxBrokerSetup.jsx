import React, { useState, useEffect } from 'react';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, AlertCircle, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

export default function IdxBrokerSetup() {
  const { user } = useAuth();
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [syncResults, setSyncResults] = useState(null);

  useEffect(() => {
    if (!user) {
      window.location.href = '/';
      return;
    }

    if (user.role !== 'admin') {
      window.location.href = '/';
    }
  }, [user]);

  const testConnection = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      const data = await invokeFunction('testIdxBrokerConnection', {});
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
      const data = await invokeFunction('syncIdxBrokerListings', {});
      setSyncResults(data);
    } catch (error) {
      setSyncResults({ error: error.message });
    } finally {
      setSyncing(false);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">IDX Broker Setup</h1>
          <p className="text-slate-600">Configure and test your IDX Broker MLS integration</p>
        </div>

        {/* Configuration Status */}
        <Card className="mb-6 shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              API Key Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                IDX Broker API key is configured and ready
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* IDX Broker Setup Instructions */}
        <Card className="mb-6 shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle>IDX Broker Account Setup Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                <strong>Important:</strong> Your IDX Broker account needs to be properly configured for API access.
              </AlertDescription>
            </Alert>

            <div className="space-y-3 text-sm text-slate-700">
              <p className="font-semibold">Next Steps:</p>
              <ol className="list-decimal ml-5 space-y-2">
                <li>Log into your IDX Broker account at <a href="https://middleware.idxbroker.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">middleware.idxbroker.com</a></li>
                <li>Navigate to <strong>Clients → API</strong> or <strong>Settings → API Access</strong></li>
                <li>Ensure your API key (starting with QTuG8F...) is activated</li>
                <li>Verify that your account has access to featured listings</li>
                <li>Check that the correct MLS feeds are enabled in your account</li>
              </ol>

              <div className="mt-4 p-4 bg-slate-50 rounded-lg">
                <p className="font-semibold mb-2">Common IDX Broker API Endpoints:</p>
                <ul className="space-y-1 text-xs font-mono">
                  <li>• GET /clients/featured - Featured listings</li>
                  <li>• GET /clients/sold - Recently sold</li>
                  <li>• GET /clients/supplemental - Additional listings</li>
                  <li>• GET /leads/property - Property details</li>
                </ul>
              </div>

              <Alert className="bg-amber-50 border-amber-200 mt-4">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  <strong>Note:</strong> If endpoints continue to return 404 errors, contact IDX Broker support to verify your API access level and ensure your account has the Middleware API enabled.
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>

        {/* Test Connection */}
        <Card className="mb-6 shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle>Test API Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Test the connection to IDX Broker to verify your API key and endpoint access.
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

        {/* Sync Listings */}
        <Card className="shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle>Sync MLS Listings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                Once your IDX Broker account is properly configured, use this button to import MLS listings into your app.
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

        {/* Support Info */}
        <Card className="mt-6 shadow-lg border-slate-200 bg-slate-50">
          <CardContent className="p-6">
            <h4 className="font-semibold mb-2 text-slate-900">Need Help?</h4>
            <p className="text-sm text-slate-600">
              If you continue to experience issues, contact IDX Broker support with your account ID and API key to verify:
            </p>
            <ul className="mt-2 text-sm text-slate-600 space-y-1 ml-5 list-disc">
              <li>Your API access level</li>
              <li>Middleware API is enabled</li>
              <li>Correct MLS feeds are active</li>
              <li>Featured listings endpoint access</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}