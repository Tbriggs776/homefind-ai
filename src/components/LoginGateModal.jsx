import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { X, Lock, Home } from 'lucide-react';

export default function LoginGateModal({ onClose }) {
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate('/Login');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
        >
          <X className="h-4 w-4 text-gray-500" />
        </button>

        <div className="h-16 w-16 bg-[#52ADEA]/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Lock className="h-8 w-8 text-[#52ADEA]" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-2">View All Photos</h2>
        <p className="text-gray-500 text-sm mb-6">
          Create a free account to browse all property photos, save your favorites, and get personalized recommendations.
        </p>

        <Button
          className="w-full bg-[#52ADEA] hover:bg-[#3a9dd8] text-white font-semibold mb-3"
          onClick={handleLogin}
        >
          Sign Up — It's Free
        </Button>
        <Button
          variant="ghost"
          className="w-full text-gray-600"
          onClick={handleLogin}
        >
          Already have an account? Sign In
        </Button>
      </div>
    </div>
  );
}