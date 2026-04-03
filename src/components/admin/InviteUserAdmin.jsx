import React, { useState } from 'react';
import { invokeFunction } from '@/api/supabaseClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus, Loader2, Check, AlertCircle } from 'lucide-react';

export default function InviteUserAdmin() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [result, setResult] = useState(null);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setResult(null);

    try {
      const data = await invokeFunction('inviteUserAdmin', {
        email,
        full_name: fullName
      });

      if (data?.success) {
        setResult({ success: true, message: data.message });
        setEmail('');
        setFullName('');
      } else {
        setResult({ success: false, message: data?.error || 'Failed to invite user admin' });
      }
    } catch (error) {
      setResult({ success: false, message: error.message });
    } finally {
      setInviting(false);
    }
  };

  return (
    <Card className="shadow-lg border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Invite User Admin
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              type="text"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="agent@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {result && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {result.success ? (
                <Check className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
              <span className="text-sm">{result.message}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={inviting}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white"
          >
            {inviting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Sending Invitation...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite User Admin
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}