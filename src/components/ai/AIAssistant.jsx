import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, X, Send, Loader2, Sparkles, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, invokeFunction } from '@/api/supabaseClient';
import ReactMarkdown from 'react-markdown';

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

      const assistantMessage = { role: 'assistant', content: data?.response || data };
      setMessages(prev => [...prev, assistantMessage]);

      // Apply filters if AI returned search criteria
      if (data?.filters && onApplyFilters) {
        onApplyFilters(data.filters);
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
                                  <img key={i} src={url} className="w-20 h-20 object-cover rounded" />
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
                          <img src={url} className="w-16 h-16 object-cover rounded border" />
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