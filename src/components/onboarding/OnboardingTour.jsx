import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function OnboardingTour({ steps, onComplete, onSkip }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    setTimeout(() => onComplete(), 300);
  };

  const handleSkipTour = () => {
    setIsVisible(false);
    setTimeout(() => onSkip(), 300);
  };

  useEffect(() => {
    const element = document.querySelector(steps[currentStep].target);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-4', 'ring-blue-500', 'ring-opacity-50', 'rounded-lg');
      
      return () => {
        element.classList.remove('ring-4', 'ring-blue-500', 'ring-opacity-50', 'rounded-lg');
      };
    }
  }, [currentStep, steps]);

  if (!isVisible) return null;

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="w-full max-w-lg"
        >
          <Card className="shadow-2xl border-blue-500">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-xl mb-1">{step.title}</CardTitle>
                  <p className="text-sm text-slate-600">
                    Step {currentStep + 1} of {steps.length}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSkipTour}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full mt-3">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-slate-700">{step.content}</div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={currentStep === 0}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </Button>

                <Button
                  onClick={handleNext}
                  className="bg-blue-600 hover:bg-blue-700 gap-2"
                >
                  {currentStep === steps.length - 1 ? (
                    <>
                      <Check className="h-4 w-4" />
                      Complete
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>

              <button
                onClick={handleSkipTour}
                className="text-sm text-slate-500 hover:text-slate-700 w-full text-center"
              >
                Skip tour
              </button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}