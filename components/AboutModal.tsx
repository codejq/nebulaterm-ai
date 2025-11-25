import React from "react";
import { X, Info, Mail, Phone, MapPin, Globe } from "lucide-react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 w-full max-w-lg rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Info className="w-5 h-5 text-indigo-400" /> About NebulaTerm AI
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Logo Section */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="flex items-center justify-center w-full">
              <img
                src="/screen-shots/quantum-billing-llc-logo.png"
                alt="Quantum Billing LLC"
                className="h-16 object-contain"
              />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">NebulaTerm AI</h3>
              <p className="text-sm text-gray-400 mt-1">Version 1.0.12</p>
              <p className="text-sm text-indigo-400 mt-2">
                Next-Generation SSH Terminal Client
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-800"></div>

          {/* Company Information */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
              Developed By
            </h4>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/50 flex items-center justify-center">
                    <Info className="w-4 h-4 text-indigo-400" />
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-base font-semibold text-white">
                    Quantum Billing, LLC
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 text-sm">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-gray-300">13802 NE Airport Way</p>
                  <p className="text-gray-300">Suite 600918976</p>
                  <p className="text-gray-300">Portland, OR, 97230</p>
                  <p className="text-gray-300">United States</p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a
                  href="mailto:info@qb-solutions.us"
                  className="text-indigo-400 hover:text-indigo-300 transition"
                >
                  info@qb-solutions.us
                </a>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a
                  href="tel:+14099347680"
                  className="text-gray-300 hover:text-white transition"
                >
                  +1 409 934 7680
                </a>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <a
                  href="https://nebulaterm-ai.quantum-billing.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 transition"
                >
                  nebulaterm-ai.quantum-billing.com
                </a>
              </div>
            </div>
          </div>

          {/* Copyright */}
          <div className="text-center text-xs text-gray-500 pt-2">
            Copyright © 2024 Quantum Billing, LLC. All rights reserved.
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 flex justify-end bg-gray-900 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded transition shadow-[0_0_15px_rgba(79,70,229,0.3)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
