import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function PropertyCardSkeleton() {
  return (
    <Card className="overflow-hidden bg-white border-border">
      <Skeleton className="aspect-[3/2] w-full rounded-none" />
      <CardContent className="p-5">
        <div className="mb-3 space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-full max-w-[260px]" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex items-center gap-4 mb-4">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function PropertyCardSkeletonGrid({ count = 6, className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-6' }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <PropertyCardSkeleton key={i} />
      ))}
    </div>
  );
}
