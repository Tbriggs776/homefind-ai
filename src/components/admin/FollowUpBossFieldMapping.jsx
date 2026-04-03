import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Loader2, MapPin } from 'lucide-react';

export default function FollowUpBossFieldMapping() {
  const [newMapping, setNewMapping] = useState({
    fub_field_name: '',
    fub_field_label: '',
    user_field_name: '',
    field_type: 'text'
  });
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['fub-field-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fub_field_mappings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const createMappingMutation = useMutation({
    mutationFn: async (mapping) => {
      const { data, error } = await supabase
        .from('fub_field_mappings')
        .insert(mapping);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fub-field-mappings'] });
      setNewMapping({ fub_field_name: '', fub_field_label: '', user_field_name: '', field_type: 'text' });
    }
  });

  const updateMappingMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { data: result, error } = await supabase
        .from('fub_field_mappings')
        .update(data)
        .eq('id', id);
      if (error) throw error;
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fub-field-mappings'] })
  });

  const deleteMappingMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('fub_field_mappings')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fub-field-mappings'] })
  });

  const handleAddMapping = async (e) => {
    e.preventDefault();
    if (!newMapping.fub_field_name || !newMapping.user_field_name) return;
    
    await createMappingMutation.mutateAsync({
      ...newMapping,
      fub_field_label: newMapping.fub_field_label || newMapping.fub_field_name
    });
  };

  const toggleActive = (id, currentStatus) => {
    updateMappingMutation.mutate({ id, data: { is_active: !currentStatus } });
  };

  return (
    <Card className="shadow-lg border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Custom Field Mapping
        </CardTitle>
        <p className="text-sm text-slate-600">
          Map Follow Up Boss custom fields to user profile fields for automatic synchronization
        </p>
      </CardHeader>
      <CardContent>
        {/* Add New Mapping Form */}
        <form onSubmit={handleAddMapping} className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="font-semibold text-slate-900 mb-4">Add New Field Mapping</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <Label>FUB Field Name</Label>
              <Input
                placeholder="custom_field_1"
                value={newMapping.fub_field_name}
                onChange={(e) => setNewMapping({ ...newMapping, fub_field_name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Display Label</Label>
              <Input
                placeholder="Budget"
                value={newMapping.fub_field_label}
                onChange={(e) => setNewMapping({ ...newMapping, fub_field_label: e.target.value })}
              />
            </div>
            <div>
              <Label>User Field Name</Label>
              <Input
                placeholder="budget"
                value={newMapping.user_field_name}
                onChange={(e) => setNewMapping({ ...newMapping, user_field_name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Field Type</Label>
              <Select value={newMapping.field_type} onValueChange={(val) => setNewMapping({ ...newMapping, field_type: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={createMappingMutation.isPending} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>
        </form>

        {/* Existing Mappings */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
          </div>
        ) : mappings.length === 0 ? (
          <div className="text-center py-8 text-slate-600">
            No field mappings configured yet. Add your first mapping above.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>FUB Field</TableHead>
                <TableHead>Maps To</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((mapping) => (
                <TableRow key={mapping.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{mapping.fub_field_label || mapping.fub_field_name}</div>
                      <div className="text-xs text-slate-500">{mapping.fub_field_name}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-sm bg-slate-100 px-2 py-1 rounded">{mapping.user_field_name}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{mapping.field_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={mapping.is_active}
                        onCheckedChange={() => toggleActive(mapping.id, mapping.is_active)}
                      />
                      <span className="text-sm text-slate-600">
                        {mapping.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMappingMutation.mutate(mapping.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}