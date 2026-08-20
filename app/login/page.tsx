"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase"; // Use relative import to avoid path alias issues

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize the Supabase connection
  const supabase = createClient();

  // Step 1: Tell Supabase to send the OTP email
  const handleSendCode = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
    });

    setIsLoading(false);

    if (error) {
      alert(error.message);
    } else {
      setIsSubmitted(true);
    }
  };

  // Step 2: Send the 6-digit code back to Supabase to verify
  const handleVerifyCode = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    
    const { data, error } = await supabase.auth.verifyOtp({
      email: email,
      token: otp,
      type: "email", // Explicitly state we are verifying an email code
    });

    setIsLoading(false);

    if (error) {
      alert("Invalid code. Please try again.");
    } else if (data.session) {
      alert("Success! You are now logged in.");
      // We will add routing here later to send them to the catalog or admin page
    }
  };

  return (
    <div className="min-h-screen pt-32 pb-24 flex items-center justify-center bg-ssuni-light1 px-6">
      <div className="w-full max-w-md bg-white border border-ssuni-slate/20 shadow-sm p-10 text-center">
        
        {/* Brand Header */}
        <h1 className="font-cinzel text-3xl text-ssuni-brown mb-2">SSUNI</h1>
        <p className="font-belleza text-ssuni-slate text-sm mb-8">
          {isSubmitted ? "Check your inbox" : "Sign in to your account"}
        </p>

        {/* Step 1: Request Code Form */}
        {!isSubmitted ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-5 text-left">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="font-belleza text-xs uppercase tracking-widest text-ssuni-brown">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="studio@example.com"
                className="w-full border border-ssuni-slate/30 p-3 font-belleza text-sm text-ssuni-brown focus:outline-none focus:border-ssuni-brown transition-colors bg-ssuni-light2"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !email}
              className="w-full py-4 mt-2 font-belleza uppercase tracking-widest text-sm transition-all bg-ssuni-brown text-ssuni-light1 hover:bg-ssuni-slate disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ssuni-brown"
            >
              {isLoading ? "Sending..." : "Send Login Code"}
            </button>
          </form>
        ) : (
          /* Step 2: Verify Code Form */
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-5 text-left">
            <p className="font-belleza text-sm text-center text-ssuni-slate mb-2">
                We sent an 8-digit code to <span className="text-ssuni-brown">{email}</span>.
            </p>
            
            <div className="flex flex-col gap-2">
              <label htmlFor="otp" className="font-belleza text-xs uppercase tracking-widest text-ssuni-brown">
                Secure Code
              </label>
              <input
                id="otp"
                type="text"
                required
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="00000000"
                className="w-full border border-ssuni-slate/30 p-3 font-belleza text-center text-2xl tracking-[0.25em] text-ssuni-brown focus:outline-none focus:border-ssuni-brown transition-colors bg-ssuni-light2"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || otp.length < 8}
              className="w-full py-4 mt-2 font-belleza uppercase tracking-widest text-sm transition-all bg-ssuni-brown text-ssuni-light1 hover:bg-ssuni-slate disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ssuni-brown"
            >
              {isLoading ? "Verifying..." : "Sign In"}
            </button>

            <button
              type="button"
              onClick={() => setIsSubmitted(false)}
              className="text-xs font-belleza text-ssuni-slate underline hover:text-ssuni-brown mt-2 uppercase tracking-widest"
            >
              ← Use a different email
            </button>
          </form>
        )}

        {/* Back to Shop Link */}
        <div className="mt-10 border-t border-ssuni-slate/20 pt-6">
          <Link href="/catalog" className="text-xs font-belleza text-ssuni-slate hover:text-ssuni-brown uppercase tracking-widest transition-colors">
            Return to Store
          </Link>
        </div>
        
      </div>
    </div>
  );
}