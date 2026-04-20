import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, X, Send, Loader2, Sparkles, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import ReactMarkdown from 'react-markdown';

// Normalize AI-returned filters to the exact field names Search.jsx expects.
// This is defense-in-depth — even if the AI returns slightly off field names
// (min_beds, pool, property_type), we translate to (bedrooms, private_pool, property_types).
function normalizeFilters(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const f = {};

  // Direct passthroughs
  if (raw.city) f.city = String(raw.city);
  if (raw.zip_code) f.zip_code = String(raw.zip_code);
  if (raw.subdivision) f.subdivision = String(raw.subdivision);
  if (raw.min_price != null) f.min_price = String(raw.min_price);
  if (raw.max_price != null) f.max_price = String(raw.max_price);
  if (raw.min_sqft != null) f.min_sqft = String(raw.min_sqft);

  // Bedrooms — accept bedrooms, min_beds, beds, min_bedrooms
  const beds = raw.bedrooms ?? raw.min_beds ?? raw.beds ?? raw.min_bedrooms;
  if (beds != null) f.bedrooms = String(beds);

  // Bathrooms — accept bathrooms, min_baths, baths, min_bathrooms
  const baths = raw.bathrooms ?? raw.min_baths ?? raw.baths ?? raw.min_bathrooms;
  if (baths != null) f.bathrooms = String(baths);

  // Pool — accept private_pool, pool, has_pool. Default to private pool if just "pool".
  if (raw.private_pool === true || raw.pool === true || raw.has_pool === true) {
    f.private_pool = true;
  }
  if (raw.community_pool === true) f.community_pool = true;

  // Property types — accept property_types (array) or property_type (string)
  if (Array.isArray(raw.property_types) && raw.property_types.length > 0) {
    f.property_types = raw.property_types;
  } else if (typeof raw.property_type === 'string' && raw.property_type) {
    f.property_types = [raw.property_type];
  }

  return f;
}

// Build a human-readable summary of the applied filters for chat confirmation.
function summarizeFilters(f) {
  const parts = [];
  if (f.bedrooms) parts.push(`${f.bedrooms}+ bed`);
  if (f.bathrooms) parts.push(`${f.bathrooms}+ bath`);
  if (f.property_types?.length) parts.push(f.property_types.map(t => t.replace('_', ' ')).join('/'));
  if (f.city) parts.push(f.city);
  if (f.zip_code) parts.push(f.zip_code);
  if (f.subdivision) parts.push(f.subdivision);
  if (f.min_price && f.max_price) parts.push(`$${Number(f.min_price).toLocaleString()}–$${Number(f.max_price).toLocaleString()}`);
  else if (f.min_price) parts.push(`$${Number(f.min_price).toLocaleString()}+`);
  else if (f.max_price) parts.push(`under $${Number(f.max_price).toLocaleString()}`);
  if (f.min_sqft) parts.push(`${Number(f.min_sqft).toLocaleString()}+ sqft`);
  if (f.private_pool) parts.push('private pool');
  if (f.community_pool) parts.push('community pool');
  return parts.join(' · ');
}

export default function AIAssistant({ user, contextData = {}, onApplyFilters }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      // Initial greeting
      setMessages([{
        role: 'assistant',
        content: `Hi${user?.full_name ? ' ' + user.full_name.split(' ')[0] : ''}! 👋 I'm your AI home search assistant. I can help you:

📸 **Analyze property photos** - Upload images and I'll identify features, styles, and potential issues
🏡 **Provide property insights** - Get detailed analysis on any listing
📚 **Offer homebuyer guides** - First-time buyer tips, neighborhood info, mortgage guidance

What would you like to know?`
      }]);
    }
  }, [isOpen]);

  const handleImageSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const uploadedUrls = [];
    for (const file of files) {
      try {
        const timestamp = Date.now();
        const fileName = `${timestamp}-${file.name}`;
        const { data, error } = await supabase.storage
          .from('uploads')
          .upload(`ai-images/${fileName}`, file);

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('uploads')
          .getPublicUrl(`ai-images/${fileName}`);

        uploadedUrls.push(publicUrl);
      } catch (error) {
        console.error('Failed to upload image:', error);
      }
    }

    setSelectedImages(prev => [...prev, ...uploadedUrls]);
  };

  const removeImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && selectedImages.length === 0) || isLoading) return;

    const userMessage = { 
      role: 'user', 
      content: input || 'Analyze these images',
      images: selectedImages.length > 0 ? selectedImages : undefined
    };
    setMessages(prev => [...prev, userMessage]);
    
    const messageCopy = input;
    const imagesCopy = [...selectedImages];
    
    setInput('');
    setSelectedImages([]);
    setIsLoading(true);

    // Save chat message
    if (user) {
      await supabase.from('chat_messages').insert({
        user_id: user.id,
        role: 'user',
        content: messageCopy || 'Analyze these images',
        context: contextData
      });
    }

    try {
      const data = await invokeFunction('aiChatAssistant', {
        message: messageCopy || 'Analyze these images in detail',
        conversation_history: messages,
        context: contextData,
        image_urls: imagesCopy.length > 0 ? imagesCopy : undefined
      });

      const assistantMessage = { role: 'assistant', content: data?.reply || data?.response || 'No response received.' };
      setMessages(prev => [...prev, assistantMessage]);

      // Apply filters if AI returned search criteria
      if (data?.filters && onApplyFilters) {
        const normalized = normalizeFilters(data.filters);
        if (Object.keys(normalized).length > 0) {
          onApplyFilters(normalized);
          // Inject a system confirmation so the user knows the filters were applied
          const summary = summarizeFilters(normalized);
          if (summary) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ **Filters applied:** ${summary}`,
              isSystemConfirmation: true,
            }]);
          }
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I apologize, I'm having trouble responding right now. Please try again."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 md:bottom-6 z-50"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
          >
            <Button
              onClick={() => setIsOpen(true)}
              className="h-14 w-14 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 dark:from-slate-700 dark:to-slate-500 hover:from-slate-700 hover:to-slate-500 dark:hover:from-slate-600 dark:hover:to-slate-400 shadow-2xl select-none"
            >
              <Sparkles className="h-6 w-6 text-white" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.9 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 md:bottom-6 z-50 w-96 max-w-[calc(100vw-3rem)]"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
          >
            <Card className="shadow-2xl border-slate-200 dark:border-slate-700 dark:bg-slate-900 overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-slate-800 to-slate-600 dark:from-slate-900 dark:to-slate-700 text-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    <CardTitle className="text-base font-semibold">AI Assistant</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsOpen(false)}
                    className="text-white hover:bg-white/20 h-8 w-8 select-none"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {/* Messages */}
                <div className="h-96 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-800">
                  {messages.map((message, idx) => (
                    <div
                      key={idx}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                          message.role === 'user'
                            ? 'bg-slate-800 dark:bg-slate-700 text-white'
                            : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-600'
                        }`}
                      >
                        {message.role === 'user' ? (
                          <div className="space-y-2">
                            {message.images && message.images.length > 0 && (
                              <div className="flex gap-1 flex-wrap mb-2">
                                {message.images.map((url, i) => (
                                  <img key={i} src={url} alt="" loading="lazy" decoding="async" className="w-20 h-20 object-cover rounded" />
                                ))}
                              </div>
                            )}
                            <p className="text-sm">{message.content}</p>
                          </div>
                        ) : (
                          <ReactMarkdown className="text-sm prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                            {message.content}
                          </ReactMarkdown>
                        )}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl px-4 py-2.5 border border-slate-200 dark:border-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
                  {selectedImages.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {selectedImages.map((url, idx) => (
                        <div key={idx} className="relative">
                          <img src={url} alt="" loading="lazy" decoding="async" className="w-16 h-16 object-cover rounded border" />
                          <button
                            onClick={() => removeImage(idx)}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      className="shrink-0 select-none dark:border-slate-700 dark:text-slate-300"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </Button>
                    <Input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                      placeholder="Ask me anything about homes..."
                      className="border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      disabled={isLoading}
                    />
                    <Button
                      onClick={handleSend}
                      disabled={isLoading || (!input.trim() && selectedImages.length === 0)}
                      className="bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 shrink-0 select-none"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}