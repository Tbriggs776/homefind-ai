import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div
      role="status"
      className={`text-center py-16 md:py-20 px-4 flex flex-col items-center ${className}`}
    >
      {Icon && (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      {title && (
        <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-2">{title}</h2>
      )}
      {description && (
        <p className="text-muted-foreground max-w-md mb-6">{description}</p>
      )}
      {action && <div className="flex flex-wrap items-center justify-center gap-3">{action}</div>}
    </div>
  );
}
