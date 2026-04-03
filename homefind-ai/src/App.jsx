import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/lib/AuthContext';
import { ComplianceLayout } from '@/components/ARMLSCompliance';
import Navbar from '@/components/Navbar';
import Home from '@/pages/Home';
import Search from '@/pages/Search';
import PropertyDetail from '@/pages/PropertyDetail';
import AuthPage from '@/pages/AuthPage';
import SavedProperties from '@/pages/SavedProperties';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ComplianceLayout>
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/property/:id" element={<PropertyDetail />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/saved" element={<SavedProperties />} />
          </Routes>
        </ComplianceLayout>
      </AuthProvider>
    </BrowserRouter>
  );
}
