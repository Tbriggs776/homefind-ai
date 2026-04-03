import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';

export function TooltipWrapper({ children, content, side = "top" }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function InfoTooltip({ content, side = "top" }) {
  return (
    <TooltipWrapper content={content} side={side}>
      <button className="inline-flex items-center text-slate-400 hover:text-slate-600 ml-1">
        <HelpCircle className="h-4 w-4" />
      </button>
    </TooltipWrapper>
  );
}