import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';

// Landing page for the unsubscribe link in saved-search alert emails
// (savedSearchUnsubscribe redirects here with ?status=ok|invalid|error).
export default function Unsubscribed() {
  const [params] = useSearchParams();
  const status = params.get('status');

  const copy = {
    ok: { title: "You're unsubscribed", body: "We've turned off email alerts for that saved search. You can turn them back on anytime from Saved Homes." },
    invalid: { title: 'Link expired', body: 'That unsubscribe link is no longer valid. You can manage all of your alerts from Saved Homes.' },
    error: { title: 'Something went wrong', body: "We couldn't update your alerts. Please try again, or manage them from Saved Homes." },
  }[status] ?? { title: 'Manage your alerts', body: 'You can manage all of your saved-search alerts from Saved Homes.' };

  return (
    <div className="crandell-container py-20">
      <div className="max-w-md mx-auto text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <BellOff className="h-7 w-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-normal text-foreground mb-2">{copy.title}</h1>
        <p className="text-muted-foreground mb-6">{copy.body}</p>
        <Link to={createPageUrl('SavedProperties')}>
          <Button variant="brand">Go to Saved Homes</Button>
        </Link>
      </div>
    </div>
  );
}
