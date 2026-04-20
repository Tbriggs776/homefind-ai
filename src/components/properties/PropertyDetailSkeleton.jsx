import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function PropertyDetailSkeleton() {
  return (
    <div className="min-h-screen pb-12 bg-background">
      <div className="bg-white border-b border-border">
        <div className="crandell-container py-4">
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <div className="crandell-container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="overflow-hidden shadow-lg border-border">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
            </Card>

            <Card className="shadow-lg border-border">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-3 flex-1">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-5 w-3/4 max-w-md" />
                    <div className="flex gap-4 pt-2">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-28" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-10 rounded-full" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-border">
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              <Card className="border-2 border-primary shadow-lg">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-14 w-14 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  </div>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
