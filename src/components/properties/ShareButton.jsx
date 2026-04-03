import React, { useState } from 'react';
import { Share2, Check, Copy, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ShareButton({ property, variant = "icon", className = "" }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const getShareUrl = () => {
    return window.location.origin + createPageUrl('PropertyDetail') + `?id=${property.id}`;
  };

  const getShareText = () => {
    const price = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(property.price);
    return `Check out this property: ${property.address}, ${property.city}, ${property.state} ${property.zip_code || ''} — ${price} | ${property.bedrooms || 0} bed, ${property.bathrooms || 0} bath, ${property.square_feet?.toLocaleString() || '?'} sqft`;
  };

  const copyToClipboard = (e) => {
    e.stopPropagation();
    const url = getShareUrl();
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    setCopied(true);
    setOpen(false);
    setTimeout(() => setCopied(false), 2500);
  };

  const shareViaEmail = (e) => {
    e.stopPropagation();
    const url = getShareUrl();
    const text = getShareText();
    const title = `${property.address}, ${property.city}, ${property.state}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text + '\n\n' + url)}`;
  };

  const shareViaSMS = (e) => {
    e.stopPropagation();
    const url = getShareUrl();
    const text = getShareText();
    window.location.href = `sms:?body=${encodeURIComponent(text + ' ' + url)}`;
  };

  const iconSize = variant === "icon" ? "h-4 w-4" : "h-5 w-5";
  const Icon = copied ? Check : Share2;
  const iconColor = copied ? "text-green-600" : "text-slate-600";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {variant === "icon" ? (
          <button
            className={`h-9 w-9 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-all ${className}`}
            title="Share property"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon className={`${iconSize} ${iconColor}`} />
          </button>
        ) : (
          <Button variant="outline" size="icon" className={className} title="Share property" onClick={(e) => e.stopPropagation()}>
            <Icon className={`${iconSize} ${iconColor}`} />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 z-50" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={copyToClipboard} className="cursor-pointer">
          {copied ? <Check className="h-4 w-4 mr-2 text-green-600" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? 'Link Copied!' : 'Copy Link'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={shareViaEmail} className="cursor-pointer">
          <Mail className="h-4 w-4 mr-2" />
          Email
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={shareViaSMS} className="cursor-pointer">
          <MessageCircle className="h-4 w-4 mr-2" />
          Text Message
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}