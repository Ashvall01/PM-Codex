import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import gsap from 'gsap';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  subDescription?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmationDialog({
  isOpen,
  title,
  description,
  subDescription,
  confirmText = "CONFIRM",
  cancelText = "CANCEL",
  onConfirm,
  onClose
}: ConfirmationDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      gsap.fromTo(overlayRef.current, 
        { opacity: 0, backdropFilter: "blur(0px)" }, 
        { opacity: 1, backdropFilter: "blur(12px)", duration: 0.3, ease: 'power2.out' }
      );
      gsap.fromTo(contentRef.current,
        { opacity: 0, scale: 0.95, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.5)', delay: 0.1 }
      );
      
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter') onConfirm();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose, onConfirm]);

  const handleCloseAnimation = (callback: () => void) => {
    gsap.to(overlayRef.current, { opacity: 0, backdropFilter: "blur(0px)", duration: 0.2 });
    gsap.to(contentRef.current, { opacity: 0, scale: 0.95, y: 10, duration: 0.2, onComplete: callback });
  };

  const handleConfirm = () => {
    handleCloseAnimation(onConfirm);
  };

  const handleCancel = () => {
    handleCloseAnimation(onClose);
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-transparent/40"
      style={{ backdropFilter: 'blur(12px)' }}
    >
      <div 
        ref={contentRef}
        className="flex flex-col items-center justify-center text-center px-6 py-12 max-w-2xl w-full"
      >
        <div className="mb-6 flex justify-center">
          <svg width="100" height="100" viewBox="0 0 34.19532 29.502075" xmlns="http://www.w3.org/2000/svg" className="text-qb-orange w-24 h-24">
            <g transform="translate(-121.01484,-42.13748)">
              <path fill="currentColor" strokeWidth="0.5" d="m 136.47126,46.860189 -10.1043,17.674373 1.51722,2.627747 h 20.45664 l 1.51722,-2.627747 -10.1043,-17.674373 z" />
              <path fill="currentColor" strokeWidth="0.5" d="m 134.14065,42.13748 -13.12581,22.053951 4.04781,7.448124 h 26.0997 l 4.04781,-7.448124 -13.12581,-22.053951 z m 0.85834,2.330607 h 6.22702 l 11.53107,20.056657 -2.89904,5.15214 h -23.49108 l -2.89904,-5.15214 z" />
              <circle fill="var(--color-qb-bg)" strokeWidth="0.5" cx="138.1125" cy="62.991432" r="1.2" />
              <path fill="var(--color-qb-bg)" strokeWidth="0.5" d="m 136.47126,52.503255 0.49041,8.525578 h 2.34714 l 0.49041,-8.525578 z" />
            </g>
          </svg>
        </div>
        
        <h2 className="text-3xl font-extrabold text-qb-orange tracking-widest uppercase mb-6 font-sans">
          {title}
        </h2>
        
        <p className="text-xl text-qb-dark-grey font-medium mb-6 font-sans">
          {description}
        </p>
        
        {subDescription && (
          <p className="text-sm text-qb-grey font-black tracking-widest uppercase mb-16 font-sans">
            {subDescription}
          </p>
        )}
        
        <div className="flex items-center gap-16 mt-8">
          <button 
            onClick={handleConfirm}
            className="group hover:opacity-80 transition-opacity"
          >
            <span className="text-qb-grey font-black tracking-widest uppercase text-lg group-hover:scale-105 transition-transform origin-center inline-block">
              {confirmText}
            </span>
          </button>
          
          <button 
            onClick={handleCancel}
            className="group hover:opacity-80 transition-opacity"
          >
            <span className="text-qb-orange font-black tracking-widest uppercase text-lg group-hover:scale-105 transition-transform origin-center inline-block">
              {cancelText}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
