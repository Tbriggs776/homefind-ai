import React, { useState, useEffect } from 'react';
import { invokeFunction } from '@/api/supabaseClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mail, Loader2, Check, AlertCircle, Search, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function FollowUpBossContacts() {
  const [searchTerm, setSearchTerm] = useState('');
  const [invitingId, setInvitingId] = useState(null);
  const [inviteResults, setInviteResults] = useState({});
  const [selectedRoles, setSelectedRoles] = useState({});
  const [syncingId, setSyncingId] = useState(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['fubContacts'],
    queryFn: async () => {
      const result = await invokeFunction('syncFollowUpBossContacts', {});
      return result;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleInvite = async (contact) => {
    setInvitingId(contact.id);
    try {
      const result = await invokeFunction('inviteUserFromFollowUpBoss', {
        email: contact.email,
        name: contact.name,
        assigned_role: selectedRoles[contact.id] || 'lead'
      });

      setInviteResults(prev => ({
        ...prev,
        [contact.id]: { success: true, message: result.message }
      }));

      toast.success('Contact invited successfully');
      setTimeout(() => refetch(), 2000);
    } catch (error) {
      setInviteResults(prev => ({
        ...prev,
        [contact.id]: { success: false, message: error.message || 'Failed to invite' }
      }));
      toast.error('Failed to invite contact');
    } finally {
      setInvitingId(null);
    }
  };

  const handleManualSync = async (contact) => {
    setSyncingId(contact.id);

    try {
      const result = await invokeFunction('syncSingleFollowUpBossContact', {
        contact_email: contact.email,
        contact_name: contact.name,
        contact_id: contact.id
      });
      
      queryClient.invalidateQueries({ queryKey: ['fubContacts'] });
      queryClient.invalidateQueries({ queryKey: ['fub-sync-history'] });
      toast.success(`${contact.name} synced successfully`);
    } catch (error) {
      console.error('Sync error:', error);
      toast.error('Failed to sync contact');
    } finally {
      setSyncingId(null);
    }
  };

  const filteredContacts = data?.contacts?.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <Card className="bg-white border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Follow Up Boss Contacts
        </CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          Import and invite contacts from Follow Up Boss to use the platform
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <p className="text-sm text-slate-600">Total Contacts</p>
            <p className="text-2xl font-bold text-slate-900">
              {isLoading ? '-' : data?.total_contacts || 0}
            </p>
          </div>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <p className="text-sm text-slate-600">Invited Users</p>
            <p className="text-2xl font-bold text-slate-900">
              {isLoading ? '-' : data?.invited_users || 0}
            </p>
          </div>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <p className="text-sm text-slate-600">Available to Invite</p>
            <p className="text-2xl font-bold text-slate-900">
              {isLoading ? '-' : data?.uninvited_contacts || 0}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 border-slate-300"
          />
        </div>

        {/* Contacts List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-600">
                {searchTerm ? 'No contacts match your search' : 'No contacts available to invite'}
              </p>
            </div>
          ) : (
            filteredContacts.map(contact => {
              const result = inviteResults[contact.id];
              return (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{contact.name}</p>
                    <p className="text-sm text-slate-600">
                      {typeof contact.email === 'string' 
                        ? contact.email 
                        : contact.email?.value || 'No email'}
                    </p>
                    {contact.phone && (
                      <p className="text-xs text-slate-500">
                        {typeof contact.phone === 'string' 
                          ? contact.phone 
                          : contact.phone?.value || ''}
                      </p>
                    )}
                    {contact.company && (
                      <Badge variant="secondary" className="mt-1 bg-slate-200 text-slate-700 border-0">
                        {contact.company}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3 ml-4">
                    {result ? (
                      <div className="flex items-center gap-2">
                        {result.success ? (
                          <>
                            <Check className="h-5 w-5 text-green-600" />
                            <span className="text-sm text-green-600">Invited</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-5 w-5 text-red-600" />
                            <span className="text-sm text-red-600 max-w-[150px] truncate">{result.message}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        <Select
                          value={selectedRoles[contact.id] || 'lead'}
                          onValueChange={(role) => setSelectedRoles(prev => ({ ...prev, [contact.id]: role }))}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lead">Lead</SelectItem>
                            <SelectItem value="client">Client</SelectItem>
                            <SelectItem value="partner">Partner</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={() => handleManualSync(contact)}
                          disabled={syncingId === contact.id}
                          size="sm"
                          variant="outline"
                          title="Sync this contact with custom field mappings"
                        >
                          {syncingId === contact.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          onClick={() => handleInvite(contact)}
                          disabled={invitingId === contact.id}
                          size="sm"
                          className="bg-slate-800 hover:bg-slate-700 text-white"
                        >
                          {invitingId === contact.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Inviting...
                            </>
                          ) : (
                            <>
                              <Mail className="h-4 w-4 mr-2" />
                              Invite
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Refresh Button */}
        <Button
          onClick={() => refetch()}
          variant="outline"
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Refreshing...
            </>
          ) : (
            'Refresh Contacts'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}