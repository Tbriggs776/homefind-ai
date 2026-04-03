import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { History, CheckCircle, XCircle, Loader2, Search, Filter } from 'lucide-react';
import { format } from 'date-fns';

export default function FollowUpBossSyncHistory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const { data: syncHistory = [], isLoading } = useQuery({
    queryKey: ['fub-sync-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fub_sync_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  const filteredHistory = syncHistory.filter(sync => {
    const matchesSearch = sync.contact_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sync.contact_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || sync.status === statusFilter;
    const matchesType = typeFilter === 'all' || sync.sync_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const stats = {
    total: syncHistory.length,
    success: syncHistory.filter(s => s.status === 'success').length,
    failed: syncHistory.filter(s => s.status === 'failed').length,
    manual: syncHistory.filter(s => s.sync_type === 'manual').length
  };

  return (
    <Card className="shadow-lg border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Sync History
        </CardTitle>
        <div className="flex gap-4 mt-4">
          <div className="text-sm">
            <span className="text-slate-600">Total: </span>
            <span className="font-semibold">{stats.total}</span>
          </div>
          <div className="text-sm">
            <span className="text-slate-600">Success: </span>
            <span className="font-semibold text-green-600">{stats.success}</span>
          </div>
          <div className="text-sm">
            <span className="text-slate-600">Failed: </span>
            <span className="font-semibold text-red-600">{stats.failed}</span>
          </div>
          <div className="text-sm">
            <span className="text-slate-600">Manual: </span>
            <span className="font-semibold text-blue-600">{stats.manual}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by contact name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="auto">Auto Sync</SelectItem>
              <SelectItem value="manual">Manual Sync</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* History Table */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-8 text-slate-600">
            No sync history found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Triggered By</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((sync) => (
                  <TableRow key={sync.id}>
                    <TableCell className="text-sm text-slate-600">
                      {format(new Date(sync.created_at), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{sync.contact_name}</div>
                        <div className="text-xs text-slate-500">{sync.contact_email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {sync.status === 'success' ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">
                          <XCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sync.sync_type === 'manual' ? 'default' : 'outline'}>
                        {sync.sync_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {sync.triggered_by || 'System'}
                    </TableCell>
                    <TableCell>
                      {sync.error_message ? (
                        <div className="text-xs text-red-600 max-w-xs truncate" title={sync.error_message}>
                          {sync.error_message}
                        </div>
                      ) : sync.synced_fields ? (
                        <div className="text-xs text-slate-500">
                          {Object.keys(sync.synced_fields).length} fields synced
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}