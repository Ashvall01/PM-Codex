import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Check, Copy, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { MOCK_GAS_SCRIPT, EXPECTED_GAS_VERSION } from '../../services/gasSyncService';

const SetupWizard: React.FC = () => {
  const { setGasUrl } = useAppStore();
  const [step, setStep] = useState(1);
  const [inputUrl, setInputUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showBypass, setShowBypass] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(MOCK_GAS_SCRIPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = async (force = false) => {
    const cleanUrl = inputUrl.trim();
    if (!cleanUrl) {
      setError('PLEASE ENTER A VALID URL.');
      return;
    }

    if (force) {
      setGasUrl(cleanUrl);
      return;
    }

    setError('');
    setIsConnecting(true);
    setShowBypass(false);

    try {
      const response = await fetch(`${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}action=version&t=${Date.now()}`);
      const text = await response.text();
      const trimmedText = text.trim();
      if (trimmedText.startsWith('<!DOCTYPE') || trimmedText.startsWith('<html') || trimmedText.startsWith('<DOCTYPE')) {
          setError('RECEIVED HTML RESPONSE: Ensure you pasted the script "Web app URL" (ending in /exec), NOT the Sheet editor URL or Apps Script editor URL.');
          setShowBypass(true);
          return;
      }
      
      let data;
      try {
          data = JSON.parse(text);
      } catch (e) {
          setError('INVALID RESPONSE FORMAT: Script returned non-JSON data. Make sure Deploy settings are configured as Web App with Anyone access.');
          setShowBypass(true);
          return;
      }
      
      if (data.version !== EXPECTED_GAS_VERSION) {
          setError('VERSION MISMATCH. Expected ' + EXPECTED_GAS_VERSION + ' but got ' + (data.version || 'unknown'));
          setShowBypass(true);
          return;
      }
      setGasUrl(cleanUrl);
    } catch (e: any) {
       console.error("Connection error:", e);
       setError('COULD NOT DIRECTLY VERIFY URL (CORS / Network restriction). If your Apps Script Web App is deployed with Access set to "Anyone", you can force complete setup.');
       setShowBypass(true);
    } finally {
       setIsConnecting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleConnect();
    }
  };

  return (
    <div className="fixed inset-0 bg-qb-bg overflow-y-auto z-50">
      <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-8 animate-in fade-in duration-500">
       
      {/* Warning Icon */}
      <div className="mb-6 flex flex-col items-center mt-8">
         <svg width="100" height="100" viewBox="0 0 34.19532 29.502075" xmlns="http://www.w3.org/2000/svg" className="text-qb-orange w-20 h-20 sm:w-24 sm:h-24 mb-4">
           <g transform="translate(-121.01484,-42.13748)">
             <path fill="currentColor" strokeWidth="0.5" d="m 136.47126,46.860189 -10.1043,17.674373 1.51722,2.627747 h 20.45664 l 1.51722,-2.627747 -10.1043,-17.674373 z" />
             <path fill="currentColor" strokeWidth="0.5" d="m 134.14065,42.13748 -13.12581,22.053951 4.04781,7.448124 h 26.0997 l 4.04781,-7.448124 -13.12581,-22.053951 z m 0.85834,2.330607 h 6.22702 l 11.53107,20.056657 -2.89904,5.15214 h -23.49108 l -2.89904,-5.15214 z" />
             <circle fill="var(--color-qb-bg)" strokeWidth="0.5" cx="138.1125" cy="62.991432" r="1.2" />
             <path fill="var(--color-qb-bg)" strokeWidth="0.5" d="m 136.47126,52.503255 0.49041,8.525578 h 2.34714 l 0.49041,-8.525578 z" />
           </g>
         </svg>
         <h1 className="text-2xl sm:text-3xl font-black text-qb-orange uppercase tracking-widest text-center">INITIALIZATION REQUIRED</h1>
         <p className="text-qb-grey mt-4 font-medium uppercase tracking-widest text-sm text-center">Database connection is missing. Setup will affect all future operations.</p>
      </div>

      <div className="max-w-3xl w-full border border-qb-light-grey bg-transparent p-4 sm:p-8 mt-4 mb-8 relative overflow-hidden">
        {/* Stepper */}
        <div className="flex justify-between relative mb-12 after:content-[''] after:absolute after:top-1/2 after:left-0 after:right-0 after:h-px after:bg-qb-light-grey after:-z-10">
           {[
             { id: 1, label: 'DATABASE' },
             { id: 2, label: 'DEPLOY' },
             { id: 3, label: 'CONNECT' }
           ].map((s) => (
             <div key={s.id} className="flex flex-col items-center bg-qb-bg px-4">
               <div className={`w-8 h-8 flex items-center justify-center transition-colors
                  ${step >= s.id ? 'bg-qb-orange text-white' : 'bg-qb-light-grey text-qb-grey'}
               `}>
                 <span className="font-bold text-sm">{s.id}</span>
               </div>
               <span className={`text-xs font-black uppercase tracking-widest mt-3 ${step >= s.id ? 'text-qb-black' : 'text-qb-grey'}`}>
                 {s.label}
               </span>
             </div>
           ))}
        </div>

        {/* Step Content */}
        <div className="min-h-[250px] flex flex-col justify-between">
          {step === 1 && (
            <div className="space-y-6">
               <h2 className="text-xl font-black uppercase tracking-widest">1. CREATE YOUR GOOGLE SHEET DATABASE</h2>
               <p className="text-qb-black font-medium leading-relaxed">
                 Create a new Google Sheet to act as your database. This gives you full ownership of your project data. Our script will automatically generate tabs based on the data you save, preserving a human-readable schema.
               </p>
               <ul className="list-disc pl-5 text-qb-dark-grey font-medium space-y-2">
                 <li>Go to Google Sheets and create a new blank spreadsheet.</li>
                 <li>Name it something like "PM Codex Database".</li>
               </ul>
               <div className="pt-8 flex flex-col sm:flex-row sm:justify-end gap-4">
                  <button onClick={() => setStep(2)} className="bg-qb-black text-white px-8 py-3 text-sm font-black uppercase tracking-widest hover:bg-qb-orange transition-colors w-full sm:w-auto text-center">
                    NEXT STEP
                  </button>
               </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
               <h2 className="text-xl font-black uppercase tracking-widest">2. DEPLOY GOOGLE APPS SCRIPT</h2>
               <p className="text-qb-black font-medium leading-relaxed">
                 Open your Google Sheet, click on <strong className="text-qb-orange">Extensions &gt; Apps Script</strong>. Replace the default code with the script below, then click <strong className="text-qb-orange">Deploy &gt; New deployment</strong> as a Web App. Make sure access is set to "Anyone".
               </p>
               <div className="relative">
                 <pre className="bg-transparent border border-qb-light-grey text-qb-dark-grey p-4 text-xs font-mono overflow-x-auto overflow-y-auto max-h-64">
                   {MOCK_GAS_SCRIPT}
                 </pre>
                 <button 
                  onClick={handleCopy}
                  className="absolute top-2 right-2 p-2 bg-qb-bg border border-qb-light-grey hover:border-qb-orange transition-colors text-qb-black flex items-center justify-center cursor-pointer"
                  title="Copy Code"
                 >
                   {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                 </button>
               </div>
               <div className="pt-8 flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-4">
                  <button onClick={() => setStep(1)} className="text-sm font-black uppercase tracking-widest text-qb-grey hover:text-qb-black transition-colors w-full sm:w-auto py-3 sm:py-0 cursor-pointer">
                    BACK
                  </button>
                  <button onClick={() => setStep(3)} className="bg-qb-black text-white px-8 py-3 text-sm font-black uppercase tracking-widest hover:bg-qb-orange transition-colors w-full sm:w-auto text-center cursor-pointer">
                    NEXT STEP
                  </button>
               </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
               <h2 className="text-xl font-black uppercase tracking-widest">3. CONNECT APPLICATION</h2>
               <p className="text-qb-black font-medium leading-relaxed">
                 After deploying, Google will provide you with a "Web app URL". Paste that URL below to connect PM Codex to your database.
               </p>
               <div className="pt-4">
                 <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">WEB APP URL</label>
                 <input 
                   type="url" 
                   value={inputUrl}
                   onChange={(e) => setInputUrl(e.target.value)}
                   onKeyDown={handleKeyDown}
                   placeholder="https://script.google.com/macros/s/.../exec"
                   className="w-full px-4 py-3 bg-transparent border border-qb-grey focus:outline-none focus:border-qb-black transition-colors font-mono text-sm"
                 />
                 {error && (
                   <div className="mt-3 p-3 bg-red-50 border border-qb-magenta/30 flex items-start gap-2">
                     <AlertCircle className="w-4 h-4 text-qb-magenta shrink-0 mt-0.5" />
                     <p className="text-qb-magenta font-bold text-xs uppercase tracking-wide leading-relaxed">{error}</p>
                   </div>
                 )}
               </div>
               <div className="pt-8 flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-4">
                  <button 
                    onClick={() => setStep(2)} 
                    disabled={isConnecting}
                    className="text-sm font-black uppercase tracking-widest text-qb-grey hover:text-qb-black transition-colors w-full sm:w-auto py-3 sm:py-0 cursor-pointer disabled:opacity-50"
                  >
                    BACK
                  </button>
                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                    {showBypass && (
                      <button
                        onClick={() => handleConnect(true)}
                        className="border border-qb-orange text-qb-orange hover:bg-qb-orange hover:text-white px-5 py-3 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 w-full sm:w-auto cursor-pointer"
                      >
                        <span>FORCE CONNECT ANYWAY</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button 
                      onClick={() => handleConnect(false)} 
                      disabled={isConnecting || !inputUrl.trim()}
                      className="bg-qb-black text-white px-8 py-3 text-sm font-black uppercase tracking-widest hover:bg-qb-orange transition-colors flex items-center justify-center gap-2 w-full sm:w-auto cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-qb-orange" />
                          CONNECTING...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          COMPLETE SETUP
                        </>
                      )}
                    </button>
                  </div>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
};

export default SetupWizard;

